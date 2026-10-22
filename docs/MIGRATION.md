# 0.3 → 0.4

0.4 rebuilds the tool around TypeScript, React and PixiJS. The 0.3 Rust source,
tests, data, assets and documentation remain in `legacy/rust`. Its own installer
and Cargo workspace are still available from that directory. Existing prepared
0.3 binaries and release archives continue to work independently.

| Area           | 0.3 Rust                   | 0.4 Studio                                           |
| -------------- | -------------------------- | ---------------------------------------------------- |
| Authoring      | Graph nodes/edges, patches | Visual layers, direct fields, TypeScript composition |
| Editor         | Terminal/MCP               | React editor + Terminal/MCP                          |
| Rendering      | Fixed-step CPU reference   | Stateless analytic motion + PixiJS WebGL             |
| Runtime        | Standalone native binaries | Node 22.18+; browser for rendering                   |
| Project        | schema 1 `.vfxproj`        | version 0.4.0 `.vfx.json`                            |
| Undo           | Persistent project history | Browser session history + local autosave             |
| Exports        | PNG, GIF, Godot, Unity     | Same format families, new metadata/import adapter    |
| Custom recipes | JSON bindings to nodes     | Layers and trusted TypeScript effect modules         |

Old graph projects are explicitly rejected with migration guidance. There is no
automatic converter because rendering, timing, random sequences and features
do not have one-to-one semantics. Keep your 0.3 files and use the legacy tool to
reproduce them. Import original PNG sheets into Studio and rebuild the layers;
all 18 familiar preset IDs have new editable equivalents.

0.3 force nodes (attraction, vortex, Perlin fields), cached fixed-step trails,
global palette/dither/mask/wave postprocessing, parameter-binding recipe files
and persistent CLI undo are not ported. Use layers, path emission, gradients,
sprite sheets, transform keyframes and glow for new compositions, or the legacy
engine for work that requires those exact features. The portal example is now
editable ribbons rather than a masked CPU effect.

Do not expect byte equality between engines or reuse an importer intended for
0.3 metadata with 0.4 metadata. New exports include their versioned project and
adapter. Godot targets version 4; Unity targets 2022.3+ with its 2D Sprite package.
Unity Editor execution is not verified in this environment.
