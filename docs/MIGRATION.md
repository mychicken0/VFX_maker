# Project compatibility

Version 0.7.5 opens 0.4.0, 0.5.0, 0.6.0, 0.7.0, 0.7.1, 0.7.2, 0.7.3 and 0.7.4 `.vfx.json` projects and supplies defaults for
output settings, groups, editor settings, controls, variants, modifiers and particle trails. Reading does not overwrite the source file. Saving or editing writes
the current version. Unknown formats and future versions are rejected.

Texture validation now checks PNG checksums and bounded decompression before
browser image decoding. Damaged files, compressed metadata or unsupported
color profiles/bit depth need to be re-exported as a static sRGB PNG first.
Browser autosave retains its existing storage key for continuity.

Save now writes a connected disk file instead of always downloading. Use
**Project menu → Download project** for the previous portable-copy workflow.
When starting with `vfx studio file.vfx.json`, backups live next to that file.
Native browser picker backups and remembered handles live in IndexedDB; the
database upgrades in place from versions 1 or 2 to version 3. Existing Recent projects are retained.

New fields are optional on input: `groups`, `editor.range`, `editor.reference`,
layer `mask`, and path `handles`. Exports remove the preview reference from the
included editable project; normal Save keeps it.

New projects may also use `field` layers, `controls`, `variants`, per-layer
`modifiers`, particle `trail`, and image-based `spawn`. Empty arrays/disabled
trails preserve the behavior of existing projects. Component files use a separate
`vfx-component` wrapper and are imported through **Saved → Import component**,
not the normal project Open action. Saving a component excludes preview references.
Version 0.7.4 accepts saved-library items and portable components from 0.7.0,
0.7.1, 0.7.2 and 0.7.3, normalizing their wrapper and embedded project to 0.7.4 when read.

0.7.3 raises the layer/group selection budget to 64 and control bindings to 256.
The 32-key curve limit and particle, texture, file and export pixel budgets remain
separate. Automatic storyboards prefer sampled activity; use timeline mode or
explicit times for full-duration context. Export duration/timing is unaffected.

0.7.4 adds optional `editor.blueprint` node positions. Connections remain ordinary
controls/bindings; no separate graph evaluator or effect conversion is needed.
Editor pixel positions do not change rendering. Previous versions may reject this
new optional metadata if asked to read a newly saved file. Existing panel layout
is preserved; choose Reset layout to adopt the new folded Library defaults.

Optional `stage` data stores camera and plane placement for the separate 2.5D /
3D workspace. Opening a normal 2D project does not add it. The default renderer
ignores camera metadata; use explicit `view:"stage"` for baked camera output and
Stage QA. Removing layers also removes their plane placements.

0.7.5 supplies a default `stage.layers[ID].stretch` of `{x:1,y:1,z:1}` for older
placements. Uniform scale and previous placement behavior remain. Editing-view
navigation stays outside project data; explicit camera alignment is saved.
