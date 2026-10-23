# Real Blueprint MCP session · 0.7.4

![Agent-authored effect](animation.gif)

This effect was authored by the official MCP SDK client over stdio, without
operating the Studio UI. It starts from the editable blue_magic template, reads
the valid Blueprint ports, creates a Direction control and connects it to a layer's
rotation, sets a lavender gradient and adds an outline modifier.

- [Editable project](blueprint.vfx.json), [exact atomic edits](edits.json),
  [discovered final graph](graph.json).
- [Before frame](before.png), [draft inspection](draft.png),
  [committed frame](after.png), [storyboard](storyboard.png).
- [Numeric QA baseline](baseline.json), [manifest](manifest.json),
  [actual structured transcript](transcript.json).
- [Godot resource](godot/effect.tres) and [spritesheet](godot/atlas.png).

The dry run leaves the source bytes unchanged. The draft and committed clean PNG
hashes match. Reverse-order raw-RGBA parity passes for three explicit times, and
moving saved graph node positions preserves the baseline pixels. GIF and Godot
export jobs succeed. This run used one browser launch for eight render requests.

Reproduce from a built checkout, or supply an installed MCP entry:

```bash
node scripts/verify-blueprint-agent.mjs /path/to/new-output-directory
node scripts/verify-blueprint-agent.mjs /path/to/new-output-directory /path/to/vfx-mcp
```

This tests the stdio protocol and renderer; it is not a claim that an external
Codex/Claude GUI client or the Godot editor was tested. The shown frames were
also opened for visual inspection before release.
