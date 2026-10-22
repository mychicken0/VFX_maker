# Third-party notices

VFX Maker 0.4.0 uses pinned npm packages. The browser build includes PixiJS, React,
Zod, gifenc, fflate and their dependencies. Node tools use the official MCP SDK,
Commander, Playwright Core and esbuild.

The exact installed runtime inventory, package integrity values and upstream
repository URLs are in [npm-runtime.json](docs/licenses/npm-runtime.json).
Upstream license/notice texts are collected in [npm-runtime.txt](docs/licenses/npm-runtime.txt).
Runtime inventory: 116 installed packages, including the browser libraries.
Platform-specific optional packages may differ on another operating system.

Original demonstration textures are retained from our own 0.3 assets. The 0.4
editor, API and render routines are original implementation; third-party engine
source/assets have not been copied into them. Previous OSS research and Rust
dependency notices remain under [legacy/rust](legacy/rust/THIRD_PARTY_NOTICES.md).

The project's own distribution license has not been selected; package metadata
uses UNLICENSED. This does not change any upstream package's license.
