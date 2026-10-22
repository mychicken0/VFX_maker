#!/usr/bin/env bash
set -euo pipefail
vfx_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
vfx_prefix=$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "${1:-$HOME/.local}")
vfx_pack_dir=$(mktemp -d)
trap 'rm -rf -- "$vfx_pack_dir"' EXIT
cd -- "$vfx_source"
npm ci --no-audit --no-fund
npm run build
npm pack --ignore-scripts --pack-destination "$vfx_pack_dir" --json > "$vfx_pack_dir/pack.json"
vfx_archive=$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0].filename)' "$vfx_pack_dir/pack.json")
npm install --global --prefix "$vfx_prefix" "$vfx_pack_dir/$vfx_archive" --no-audit --no-fund
"$vfx_prefix/bin/vfx" --version
"$vfx_prefix/bin/vfx" doctor
