#!/usr/bin/env python3
"""Package installed Linux x86_64 tools, data, docs and dependency license texts."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, capture_output=True, text=True).stdout


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def license_texts(package):
    folder = Path(package["manifest_path"]).parent
    texts = [p for p in folder.iterdir() if p.is_file() and
             re.match(r"^(LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE)([.-]|$)", p.name, re.I)]
    if package.get("license_file"):
        declared = (folder / package["license_file"]).resolve()
        if not declared.is_relative_to(folder.resolve()) or not declared.is_file():
            raise RuntimeError(f"Missing/escaping declared license: {package['name']}")
        if declared not in texts:
            texts.append(declared)
    fallback = None
    if not texts:
        # These SDK crates declare Apache-2.0 but omit the license in crate tarballs.
        if package["name"] in ("rmcp", "rmcp-macros") and package["license"] == "Apache-2.0":
            fallback = Path("/usr/share/common-licenses/Apache-2.0")
            if not fallback.is_file():
                raise RuntimeError("Standard Apache-2.0 text unavailable")
            texts = [fallback]
        else:
            raise RuntimeError(f"No bundled license text: {package['name']} {package['version']}")
    return sorted(texts), fallback


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", type=Path, required=True, help="Installed tools prefix containing bin/")
    parser.add_argument("--out", type=Path, required=True, help="New .tar.gz archive")
    args = parser.parse_args()
    output = args.out.absolute()
    checksum = Path(str(output) + ".sha256")
    if output.exists() or checksum.exists() or not output.parent.is_dir():
        parser.error("Archive/checksum must be new files in an existing parent directory")
    metadata = json.loads(run("cargo", "metadata", "--locked", "--format-version", "1",
                              "--filter-platform", "x86_64-unknown-linux-gnu"))
    members = set(metadata["workspace_members"])
    local = [p for p in metadata["packages"] if p["id"] in members]
    versions = {p["version"] for p in local}
    if len(versions) != 1:
        raise RuntimeError("Workspace package versions differ")
    version = versions.pop()
    name = f"vfx-maker-{version}-linux-x86_64"
    with tempfile.TemporaryDirectory(prefix="vfx-package-") as temporary:
        folder = Path(temporary) / name
        (folder / "bin").mkdir(parents=True)
        requirements = {}
        for tool in ("vfx", "vfx-mcp"):
            binary = (args.prefix / "bin" / tool).resolve()
            actual_version = run(str(binary), "--version").split()[-1]
            if actual_version != version:
                raise RuntimeError(f"{tool} version {actual_version} differs from source {version}")
            elf = run("readelf", "-h", str(binary))
            if "Advanced Micro Devices X86-64" not in elf:
                raise RuntimeError("Only Linux x86_64 ELF bundles are supported")
            abi = run("readelf", "--version-info", str(binary))
            glibc = set(re.findall(r"GLIBC_([0-9.]+)", abi))
            requirements[tool] = {"sha256": digest(binary), "glibc_min": max(
                glibc, key=lambda s: tuple(int(n) for n in s.split(".")))}
            shutil.copy2(binary, folder / "bin" / tool)
        for item in ("README.md", "THIRD_PARTY_NOTICES.md", "Cargo.lock"):
            shutil.copy2(ROOT / item, folder / item)
        for item in ("docs", "presets", "examples", "integrations"):
            shutil.copytree(ROOT / item, folder / item)
        (folder / "scripts").mkdir()
        for script in ("render_gallery.py", "verify_godot.py"):
            shutil.copy2(ROOT / "scripts" / script, folder / "scripts" / script)
        reachable = {node["id"] for node in metadata["resolve"]["nodes"]}
        inventory = []
        for p in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
            if p["id"] not in reachable or not p["source"]:
                continue
            texts, fallback = license_texts(p)
            destination = folder / "licenses" / f"{p['name']}-{p['version']}"
            destination.mkdir(parents=True)
            licenses = []
            for source in texts:
                target = destination / source.name
                shutil.copy2(source, target)
                licenses.append({"file": str(target.relative_to(folder)), "sha256": digest(target)})
            inventory.append({"name": p["name"], "version": p["version"], "license": p["license"],
                              "repository": p["repository"], "authors": p["authors"],
                              "texts": licenses, "standard_license_substitution": bool(fallback)})
        std_docs = Path(run("rustc", "--print", "sysroot").strip()) / "share/doc/rust"
        std_out = folder / "licenses/rust-standard-library"
        std_out.mkdir()
        shutil.copy2(std_docs / "COPYRIGHT-library.html", std_out / "COPYRIGHT-library.html")
        shutil.copytree(std_docs / "licenses", std_out / "licenses")
        build = {"version": version, "target": "x86_64-unknown-linux-gnu",
                 "rustc": run("rustc", "--version").strip(), "binaries": requirements,
                 "source_head": run("git", "rev-parse", "HEAD").strip(),
                 "source_has_local_changes": bool(run("git", "status", "--porcelain").strip()),
                 "dependency_inventory_scope": "Target-filtered workspace resolution including build/test crates",
                 "dependencies": inventory}
        (folder / "build.json").write_text(json.dumps(build, indent=2) + "\n")
        (folder / "INSTALL.txt").write_text(f"""VFX Maker {version} — local Linux x86_64 working build

Run: bash install.sh /path/to/prefix
Then use /path/to/prefix/bin/vfx and /path/to/prefix/bin/vfx-mcp.
Default prefix is ~/.local. Existing same-name binaries are replaced.
Runtime requires Linux x86_64, glibc {max((r['glibc_min'] for r in requirements.values()), key=lambda s: tuple(map(int,s.split('.'))))}+, libgcc_s and libm.
Only the current Debian 13 environment has been validated.
No Rust, Cargo, Python, Node.js, GPU, display or internet needed by the binaries.
Python is optional for scripts/render_gallery.py only.
See README.md for CLI/MCP configuration and docs/RECIPES.md for data authoring.
See build.json and licenses/ for build metadata and dependency notices.
Project-owned source/presets/binaries have no selected distribution license.
This local artifact is not a published GitHub release.
""")
        installer = folder / "install.sh"
        installer.write_text('''#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -gt 1 ]; then
  echo "Usage: bash install.sh [prefix]" >&2
  exit 2
fi
vfx_bundle_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
vfx_destination="${1:-$HOME/.local}"
mkdir -p "$vfx_destination/bin"
install -m 755 "$vfx_bundle_root/bin/vfx" "$vfx_destination/bin/vfx"
install -m 755 "$vfx_bundle_root/bin/vfx-mcp" "$vfx_destination/bin/vfx-mcp"
printf 'Installed to %s/bin; add that directory to PATH.\\n' "$vfx_destination"
''')
        installer.chmod(0o755)
        # Normalize archive headers and gzip time; unchanged inputs yield identical bytes.
        def normalize(info):
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ""
            info.mode = 0o755 if info.isdir() or info.name in {
                f"{name}/install.sh", f"{name}/bin/vfx", f"{name}/bin/vfx-mcp"} else 0o644
            return info
        staged = Path(temporary) / "archive.tar.gz"
        with staged.open("wb") as stream:
            with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
                with tarfile.open(mode="w", fileobj=compressed, format=tarfile.PAX_FORMAT) as archive:
                    archive.add(folder, arcname=name, filter=normalize)
        # The temp directory may be on a different filesystem, so stage by destination.
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".vfx-bundle-") as target:
            with staged.open("rb") as source:
                shutil.copyfileobj(source, target)
            target.flush()
            os.fsync(target.fileno())
            os.link(target.name, output)  # atomic, no-clobber publication
        output.chmod(0o644)
        with checksum.open("x") as stream:
            stream.write(f"{digest(output)}  {output.name}\n")
        print(json.dumps({"archive": str(output), "bytes": output.stat().st_size,
                          "sha256": digest(output), "dependencies_with_licenses": len(inventory)}))


if __name__ == "__main__":
    main()
