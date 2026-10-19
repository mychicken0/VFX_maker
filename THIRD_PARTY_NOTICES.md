# Third-party dependencies

No Pixel Composer source, binary, asset, shader, or font is included. All bundled
presets are parameter recipes implemented in this repository.

The Rust dependency versions and checksums are recorded in Cargo.lock. Direct
dependencies include:

| Dependency | Purpose | License |
| --- | --- | --- |
| serde, serde_json | Typed JSON serialization | MIT OR Apache-2.0 |
| schemars | JSON Schema generation | MIT |
| clap | CLI argument parsing | MIT OR Apache-2.0 |
| gif | Native GIF encoding and palette quantization | MIT OR Apache-2.0 |
| noise | Seeded Perlin turbulence fields | MIT OR Apache-2.0 |
| png | PNG encoding and decoding | MIT OR Apache-2.0 |
| sha2 | Content hashes | MIT OR Apache-2.0 |
| tempfile | Staged and atomic file writes | MIT OR Apache-2.0 |
| fs2 | Cross-process advisory file locks | MIT OR Apache-2.0 |
| rmcp, rmcp-macros | Official Rust MCP SDK | Apache-2.0 |
| tokio, tokio-util | Async execution and framed transport | MIT |
| futures-util | Bounded transport stream adaptation | MIT OR Apache-2.0 |
| base64 | MCP preview encoding and embedded PNG asset serialization | MIT OR Apache-2.0 |

Dependency versions and registry checksums are pinned in Cargo.lock. This is a
direct-dependency inventory, not an assertion that every researched project is
linked. The [research inventory](docs/OPEN_SOURCE_RESEARCH.md) distinguishes
design references (including GPL architecture references) from integrated
dependencies. No editor/engine source was copied, translated or vendored.

`scripts/package_linux.py` collects applicable registry package metadata and
root LICENSE/LICENCE/COPYING/COPYRIGHT/NOTICE texts into `licenses/`, failing if
a package has no text. For rmcp/rmcp-macros3.3.0, whose published crates declare
Apache-2.0 but omit a root license text, the standard Apache2.0 text is included
and the substitution is labeled in the inventory. Rust standard-library
licenses are included separately in binary bundles. The inventory also covers
build/test dependencies reachable in the target-filtered workspace resolution;
it is not a claim that every listed crate contributes code to both binaries.

The repository's own distribution license has not been selected. Dependency
notices do not grant a license for project-owned source, presets or binaries.
The prepared archive is a local working build, not a published release.
