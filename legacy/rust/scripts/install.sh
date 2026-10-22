#!/usr/bin/env bash
set -euo pipefail

# Install both standalone executables. Run from any directory; no sudo needed.
vfx_source_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
vfx_install_root="${1:-${VFX_INSTALL_ROOT:-$HOME/.local}}"
if [ "$#" -gt 1 ]; then
  echo "Usage: bash scripts/install.sh [installation-prefix]" >&2
  exit 2
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust/Cargo is required to build. Install Rust, then run this script again." >&2
  exit 127
fi
vfx_build_root="${CARGO_TARGET_DIR:-$vfx_source_root/target}"
# Preserve caller-relative destinations before changing directories. Rustup
# selects its toolchain from cwd, so build inside the source to honor its pin.
mkdir -p -- "$vfx_install_root" "$vfx_build_root"
vfx_install_root="$(CDPATH= cd -- "$vfx_install_root" && pwd)"
export CARGO_TARGET_DIR="$(CDPATH= cd -- "$vfx_build_root" && pwd)"
cd "$vfx_source_root"
cargo install --locked --path "$vfx_source_root/crates/vfx-cli" --root "$vfx_install_root" --force
cargo install --locked --path "$vfx_source_root/crates/vfx-mcp" --root "$vfx_install_root" --force
printf '\nInstalled: %s/bin/vfx and %s/bin/vfx-mcp\n' "$vfx_install_root" "$vfx_install_root"
printf 'Add %s/bin to PATH, or use the absolute executable paths.\n' "$vfx_install_root"
