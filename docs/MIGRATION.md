# Project compatibility

Version 0.6 opens 0.4 and 0.5 `.vfx.json` projects and supplies defaults for
output settings, empty groups and editor settings. Reading does not overwrite the source file. Saving or editing writes
the current version. Unknown formats and future versions are rejected.

Texture validation now checks PNG checksums and bounded decompression before
browser image decoding. Damaged files, compressed metadata or unsupported
color profiles/bit depth need to be re-exported as a static sRGB PNG first.
Browser autosave retains its existing storage key for continuity.

Save now writes a connected disk file instead of always downloading. Use
**Project menu → Download project** for the previous portable-copy workflow.
When starting with `vfx studio file.vfx.json`, backups live next to that file.
Native browser picker backups and remembered handles live in IndexedDB; the
database upgrades in place from version 1. Existing Recent projects are retained.

New fields are optional on input: `groups`, `editor.range`, `editor.reference`,
layer `mask`, and path `handles`. Exports remove the preview reference from the
included editable project; normal Save keeps it.
