# 0.7.6 validation

Platform: Linux, Node 24, Chromium/SwiftShader. Browser interactions are automated
pointer/keyboard/file/download actions, with screenshots opened for visual review;
this is not a human usability study or an external Codex/Claude GUI session.

The source suite contains 87 unit tests and 86 browser/CLI/MCP scenarios. Exact
commit results are in hosted CI. New regression cases cover the reproduced faults:

- Static/wide PNG and flipbook import through actual MCP, asset optimization,
  fitted Sprite creation, nonempty preview, RGBA parity and PNG sequence export.
- All five 2D Add generators match the shared core data on a small canvas; a wide
  sprite retains its 4:1 aspect. Undo removes the last layer.
- A staged component is saved and inserted twice through the real UI. Fresh
  names/IDs, plane position/stretch, unchanged camera and reload are checked.
- A 1024×600 window with 1.3× text retains a usable measured canvas. Drawer access,
  View options, Focus timeline/Restore canvas and desktop preferences are checked.
- Numeric invariants check set/add/multiply control bindings after uniform and
  letterboxed resizing, including later changes to control values. Camera/world
  coordinates resize together; canvas-only settings remain unchanged.

The connected-file workflow now opens Studio first, then pastes the CLI file
link into that same tab and verifies Save, backups, Save As and recovery.

The existing full suite retains drawing/Bezier/curve/keyframe editing, masks,
references, selection/groups, layouts, file recovery/backups/conflicts, Blueprint
wire drags, Stage gizmos/cancel/undo, exact camera/export pixels, creative tools,
batches, rendering budgets and all five game/image export formats.

The exploratory SDK audit called all 41 tools successfully. It also read image
resources with inline images disabled, checked atomic rollback and revision/root
errors, cancelled exports, and opened actual rendered images. Its transcript and
browser captures are recorded in the cloud verification report. Some first audit
scripts used incorrect locators/IDs; those script errors were corrected, separate
from reproduced product bugs listed in the audit. The MCP PNG import failure was
reproduced with a valid request before the handler fix.

Windows/macOS launch scripts, external host image forwarding and Godot/Unity
editor imports are not verified on those systems. ZIP launchers require Node;
rendering needs Chromium. Tests establish functional regression coverage, not
artistic quality or absence of every possible defect.

Reproduce:

```bash
npm ci
npm run format:check
npm run check
node scripts/verify-catalog-agent.mjs /path/to/new-session
node scripts/render-workspace-tour.mjs /path/to/new-tour
npm pack --ignore-scripts
node scripts/package-release.mjs /path/to/packages
```
