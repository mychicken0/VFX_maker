# 0.7.4 usability research and decisions

Inspected on 2026-10-23. These are repository/source reviews and local VFX Maker
interaction tests; we did not install or benchmark the complete Artcraft application.

## Artcraft: an editor organized around the current tool

Reference: [storytold/artcraft](https://github.com/storytold/artcraft), commit
[`800217ed04d10fc12706c28e6e91ae2a6b286092`](https://github.com/storytold/artcraft/tree/800217ed04d10fc12706c28e6e91ae2a6b286092).
Read its README, LICENSE-MIT, LICENSE-APACHE, NOTICE and these sources:

- [SideToolbar.tsx](https://github.com/storytold/artcraft/blob/800217ed04d10fc12706c28e6e91ae2a6b286092/frontend/libs/components/pagedraw/src/lib/components/ui/SideToolbar.tsx): explicit active tools, visible shortcut hints and brush settings in contextual popouts.
- [TimelineEditor.tsx](https://github.com/storytold/artcraft/blob/800217ed04d10fc12706c28e6e91ae2a6b286092/frontend/libs/components/pagescene/src/lib/comps/Timeline/TimelineEditor.tsx): expanded timeline, tracks, focused selection and one undo transaction per edit gesture.
- [ModalTransformController.ts](https://github.com/storytold/artcraft/blob/800217ed04d10fc12706c28e6e91ae2a6b286092/frontend/libs/components/pagescene/src/lib/engine/editor/ModalTransformController.ts): explicit transform interaction and cancellation.
- [zoom-utils.ts](https://github.com/storytold/artcraft/blob/800217ed04d10fc12706c28e6e91ae2a6b286092/frontend/libs/components/video-editor/src/lib/timeline/zoom-utils.ts): separates duration, available width and zoom; uses a nonlinear zoom scale.

Decisions for VFX Maker: choose Move/Scale/Rotate/Points explicitly; make handles
large in screen pixels, keep cancellation and one-gesture undo; give the timeline
independent height, time zoom, horizontal scrolling and focus mode. Keep optional
view controls, source curves and detailed parameters folded. Fit the canvas to
available space instead of silently capping it at 300%.

Artcraft declares MIT OR Apache-2.0 and has additional third-party notices.
It is a design reference; **no Artcraft code, models, media or assets are copied**.
Its online generation/provider services are not dependencies of VFX Maker.

## React Flow: use a maintained graph interaction library

Reference: [xyflow/xyflow](https://github.com/xyflow/xyflow), commit
[`8523d8dd9f1551954bc221dccabd6a3119ef9e22`](https://github.com/xyflow/xyflow/tree/8523d8dd9f1551954bc221dccabd6a3119ef9e22).
Read the root MIT license and React Basic example before adopting
**@xyflow/react 12.12.0** as a pinned runtime dependency. Its own package license
and transitive notices are included in [the inventory](licenses/npm-runtime.json).

Use its node dragging, zoom/pan, connection handles, keyboard navigation,
fit and minimap. Keep VFX project semantics in our shared core, not in React Flow
callbacks: numeric control → validated layer parameter; each layer → ordered
modifiers → composition. The same connections remain inspectable/editable through
MCP. Invalid inputs reject the complete transaction. Node positions are editor
metadata; moving a node must not change rendered pixels.

The graph deliberately does not pretend to be a general expression or arbitrary
image-routing engine. Purple parameter wires are editable. Green image wires
explain the actual fixed modifier/composition pipeline; order is edited through
Modifiers. This keeps existing project/CLI/MCP exports compatible.

## Pixel Composer: expose the effect structure when requested

Reference: [Ttanasart-pt/Pixel-Composer](https://github.com/Ttanasart-pt/Pixel-Composer).
Reviewed its README and MIT license. Its node-based pixel VFX workflow supports
showing explicit ports and effect composition. Adopt the discoverable graph view
as an advanced workspace while retaining a simple canvas for ordinary drawing.
No source or assets are copied. A comparable general-purpose node catalog is not
claimed for this release.

## Concrete local checks

The old Inspector curves drew static SVG circles; those circles did not have
pointer-edit handlers. The old viewport had position/point handles but no direct
scale/rotation gizmos. Layout limited the timeline to 400px and capped fit preview
at 3×. These are source findings, not assumptions based on screenshots.

Browser regression scenarios in `tests/e2e/usability.spec.ts` exercise the new
handles, actual pen drawing, anchor/Bezier array consistency, curve dragging,
undo/cancel, time zoom/height/focus, graph drag-to-connect and disk roundtrip,
390px layouts, and a real stdio MCP discover → draft → commit → parity workflow.
The broader authoring/export/recovery suite remains required before release.

## Camera-stage follow-up

Reviewed additional Pixel Composer sources at commit
`4d71f8272e25c28c8c2588552f0978f2f9245862`:
`datasrc/Nodes/Internal/3D/Node_3D_Camera/info.json`,
`Node_3D_Scene/info.json`, `Node_3D_Transform/info.json`,
`datasrc/Nodes/Internal/pSystem/Node_pSystem_3D_Gravity/info.json` and
`scripts/panel_preview_3d_setting/panel_preview_3d_setting.gml`.
Camera-to-surface output and separately grouped scene/camera settings support a
separate advanced workspace instead of adding 3D controls to ordinary 2D drawing.
No source or assets were copied.

Read the upstream MIT license before installing **Three.js 0.186.1**. It is a
runtime dependency for actual orthographic/perspective projection, textured planes,
camera orbit and depth. Its notices appear in the generated inventory. Our Stage
renderer uses deterministic Pixi layer frames as textures and the shared export
encoder; it does not replace the 2D effect authoring engine or copy another
editor's node catalog. The 3D feature scope for this release is camera staging and
baked output, with volumetric particle simulation outside that scope.
