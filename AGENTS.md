# Project guidance

- Keep VFX Maker usable by ordinary artists. Put size, intensity, color and
  common actions first. Put parameter bindings, technical options and detailed
  curves behind named disclosures or focused dialogs.
- Maintain the TypeScript, React and PixiJS application and its portable CLI/MCP
  package. Editor, CLI and MCP must use the same validated project operations and
  renderer. Tools must work outside this repository.
- Effects are editable data. Do not add rendering branches keyed by preset names.
  Add reusable operations, generators and parameter bindings instead.
- Document only behavior and files present in the current repository. Label
  proposed features and limitations accurately.
- README showcases must be actual renders of the checked-in editable projects.
  Update their generation script and manifests when the renderer changes.
- Read upstream licenses and record sources before adopting dependencies or code.
  Distinguish installed dependencies from design references.
- Verify changes with relevant unit/browser tests, including narrow viewports,
  undo, file recovery, export pixels and installed CLI/MCP workflows when affected.
