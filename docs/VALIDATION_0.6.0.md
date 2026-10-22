# 0.6.0 verification

Verified on 22 October 2026 with Node 24.19.0 and system Chromium
154.0.8037.57 on Linux, using actual PixiJS WebGL/SwiftShader rendering.

| Check                               | Result                            |
| ----------------------------------- | --------------------------------- |
| TypeScript                          | `npm run typecheck` passes        |
| Core, storage and native-save tests | 44 tests pass                     |
| Chromium end-to-end tests           | 30 tests pass in one isolated run |
| Runtime dependency audit            | 0 reported vulnerabilities        |
| Built editor and Node tools         | Production build succeeds         |

The eight new browser scenarios verify multi-selection, grouping, shared
transforms and duplication; direct timeline key insertion/drag/cancellation;
actual adjacent-frame onion pixels; playback ranges without trimming exports;
freehand creation and Bezier/mask handles; reference positioning with unchanged
exported RGBA and no reference in exported source; disk Save/Save As, backup
restoration, stale revision protection and abrupt tab-close recovery; native
file-handle persistence and backup continuity on reopening; and usable timeline
focus at 640 × 360 and 390px widths.

Mask tests compare actual RGBA for rectangle, ellipse and polygon clips and
compare PNG sequence output to preview. Bezier tests check visible curved pixels
and transparent pixels where an uncurved stroke would be. Existing tests still
exercise all 18 templates, alpha/blending, deterministic scrubbing, PNG/GIF/atlas
encoding, engine adapters, pixel optimization, small windows, focus and undo.

The storage tests cover five-version retention, restoration backing up the
current file, invalid/stale edits, concurrent edits and a backup symlink escape
leaving the original unchanged. Server tests verify bearer authentication,
request origin, document identity, revision conflicts and protected Save As
paths. Native-save tests cover permission denial, backup failure, external
changes before/during saving and failed-stream abortion.

The tarball was packed and installed under `/workspace/.vfx-js-tools`, and its
CLI/MCP workflow tests were repeated using those installed executables. An
18-effect gallery and the new Bezier example were rendered with the real engine.

The CLI/MCP workflows run outside the checkout in a Thai path containing spaces.
They exercise groups, selection transforms, keyframes and backup restoration,
all export formats, trusted TypeScript building, pixel tools and the official
MCP protocol client discovering 26 tools.

The test run used for these results was sequential with a separate output
folder (`/tmp/vfx06-e2e-verified`). An earlier overlapping local run was discarded
because the runners shared their trace output directory.

## CI investigation

The supplied screenshot refers to commit `1290984` and GitHub Actions run
[39731481300](https://github.com/mychicken0/VFX_maker/actions/runs/39731481300).
GitHub's job API confirms that formatting, typecheck, unit tests and build
passed; the end-to-end test step failed. The detailed archived log download
redirects to a storage host blocked by the active cloud network policy, so the
individual failure from that run has not been confirmed here.

The 0.6 workflow pins Ubuntu 24.04 during the announced `ubuntu-latest` migration,
uploads the 0.6 tarball, and uses Playwright's GitHub reporter to put individual
test failures directly into check annotations. Local results do not imply a
hosted CI pass; inspect the latest commit's check separately.

## Limits of the verification

Linux/Chromium and the official MCP SDK protocol client are exercised. External
Codex/Claude GUI configuration, Windows/macOS, Safari/Firefox and Unity Editor
were not exercised in this pass. Native picker behavior is tested using real
browser file handles backed by the origin-private filesystem; choosing an OS
file through a manual system picker is not automated. Browser storage and
permission persistence remain dependent on browser policy.
