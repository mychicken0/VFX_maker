# Project compatibility

Version 0.5 opens 0.4 `.vfx.json` projects and supplies defaults for new output
settings. Reading does not overwrite the source file. Saving or editing writes
the current version. Unknown formats and future versions are rejected.

Texture validation now checks PNG checksums and bounded decompression before
browser image decoding. Damaged files, compressed metadata or unsupported
color profiles/bit depth need to be re-exported as a static sRGB PNG first.
Browser autosave retains its existing storage key for continuity.
