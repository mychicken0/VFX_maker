# Saving and authoring in Studio

## Disk files, backups and recovery

Start `vfx studio effect.vfx.json --open` inside your effect folder. **Save** or
Ctrl/⌘ S writes that connected file; the filename appears in the status bar.
**Project menu → Save As** or Ctrl/⌘ Shift S chooses a new relative `.json`
filename inside the same root. Its parent directory must exist. Existing paths
are protected. Subsequent saves use the new file. Opening/importing another
project detaches the previous binding.

The local server validates each edit and compares the current disk SHA-256 to
the revision loaded by Studio. External changes cause a conflict; reopen the
file or use Save As. It also checks document identity so another tab's Save As
cannot redirect an old tab's Save. File operations require the session's random
bearer token; writes check the request origin. The server binds to loopback.

Before replacing a file, `.vfx-backups` stores the original bytes. It retains
five distinct versions per project, and **Project menu → File backups** restores
one. Restoration also backs up the current file. A backup/write failure leaves
the original file intact. Successful saves use atomic file replacement; a hard
process kill during a command can leave `FILE.lock`. Confirm no edit is active
before removing that sidecar.

In browsers with the File System Access API, **Open** and **Save As** can connect
a native disk handle. The handle persists in IndexedDB and permission may need
to be granted again. Backups live in IndexedDB, not next to this native file.
The browser's replacement stream is aborted on errors. Browsers without that
API use file import and download; **Project menu → Download project** always
creates a portable copy and keeps the current binding.

Autosave runs after 500 ms of inactivity and on a normal page close. Reopening
the same connected file offers unsaved browser work or the disk version when
they differ. Keep the same browser profile and origin/port. Browser recovery
contains the latest browser snapshot, while **Recent** retains eight named
snapshots and File backups retain versions from before saves. Clearing site
data removes browser recovery, recent projects, native handles and browser
backups. Changes since the last completed autosave may be lost after a hard
close; the status bar reports storage errors.

## Selection and groups

Ctrl/⌘-click toggles layer selection; Shift-click selects a visual range. Click
**Group selection**, then rename in the selection Inspector. Group chips recall
the selection; Ungroup removes the collection. Groups are flat named selections
and preserve the existing layer order and blending.

Drag the selected anchor to move all selected unlocked layers, or enter X/Y
offsets, rotation and uniform scale in the selection Inspector. **Apply
transform** makes one undoable edit around the mean selected unlocked anchor.
Blend, visibility and opacity curves can be changed together. Locked layers are
skipped unless **Include locked in selection edits** is enabled. Duplicating a
complete group creates another group with fresh IDs. Removing layers removes
stale group members. Selection edits use the same core helpers as CLI/MCP.

World-space X/Y motion scales and rotates with the selection. Rotating differently
eased nonlinear X/Y curves is rejected until their key times and easing align;
translation and scale preserve independent easing.

## Timeline

Clips change layer start/duration. **Keyframes** opens the selected layer's
channel graph at project time. Choose opacity, a transform channel or an
available geometry channel; double-click to add and drag keys to change time
and value. Keys cannot cross neighbors. Frame snapping is optional. Numeric
time/value/easing and Delete key provide exact editing. A curve keeps at least
one key and at most 32; pointer cancellation discards drafts.

**Loop range** sets a playback work area. Playback wraps inside it even when
whole-project looping is off. Scrubbing and frame stepping can still inspect
the full project. Exports always use the full duration. **Onion** shows the
previous and next project frame in separate translucent canvases; it pauses
playback and never changes exported pixels.

## Freehand, Bezier and masks

**Freehand** records a stroke in canvas coordinates. Release creates a normal
editable path layer in one undoable edit. Simplification preserves endpoints
and limits the result to 64 anchors. **Bezier** adds incoming/outgoing tangent
handles to each anchor; select a numbered anchor, then drag its tangent circles.
Anchor moves retain their relative tangents. Double-click still adds anchors.
The same sampled cubic path renders in preview and all exports.

Enable **Layer mask** in the Inspector and choose rectangle, ellipse or polygon.
**Mask edit** drags its center, size corner or polygon vertices. Coordinates are
local to the layer, so the mask follows animated transforms and clips its glow.
One mask is available per layer; polygon masks contain 3–64 vertices. Hand,
Freehand, Mask edit and Reference move are separate canvas interaction modes.

## Character and scene reference

Open **Reference** in the Library and import a static PNG (up to 1 MiB and
1024 pixels per side). Position it numerically or with **Reference move**, then
adjust scale, opacity and whether it appears behind or above the effect.
The saved project embeds this image so it can travel with your work.

Reference images are separate from effect assets. They never enter the renderer,
GIF, atlas, PNG sequence or engine files. Exported editable source also omits the
reference; normal Save/Download project retains it. Whole-composition resizing
moves and scales the reference to preserve alignment.
