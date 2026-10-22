# VFX Maker 0.7.1

This patch fixes the Effects library collapsing into thin, unreadable strips.
Cards now keep the height of their thumbnail, name and description. The list
scrolls to all 22 effects, with search and the undo hint remaining visible.

- Each library tab has a bounded scroll area. Layers, add-layer buttons, saved
  components, texture controls and reference settings remain reachable in short
  windows and when the project contains 32 layers or 8 textures.
  At the minimum sidebar width, tab names keep their width and scroll horizontally.
- Search shows the number of matching effects, ignores surrounding spaces and
  offers **Clear search** when there are no matches. Empty Assets explains how
  to import a texture. Long texture filenames wrap inside their cards.
- **Play** and **Space** restart a non-looping effect when the playhead is at its
  end. **Restart playback** starts at the beginning of the effect or loop range.
  The renderer still displays the actual frame: a faded-out tail can be empty.
- Multi-channel keyframe commands sit in a collapsed **Key tools** disclosure,
  leaving keys visible in a short window. Open it for move/duplicate, copy/paste,
  delete, frame snapping and numeric offsets. Arrow-key editing remains available.
- Play/pause and the Export arrow use SVG icons to avoid platform emoji glyphs.
- Space activates focused buttons and disclosures normally; the global playback
  shortcut no longer intercepts their keyboard activation.
- Existing 0.7.0 projects open without losing their controls, modifiers or looks.
  Saved components and portable component files from 0.7.0 also open in 0.7.1.
  Normal Save writes version 0.7.1; reading a file does not overwrite it.

The README Studio image is recaptured from the built application with Effects
open. GIFs remain actual exports of the accompanying editable projects.

See [executed checks and screenshots](VALIDATION_0.7.1.md) and
[0.7.0 authoring features](RELEASE_0.7.0.md).
