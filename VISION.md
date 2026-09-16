# Vision: proj-cli

## Project type
Personal developer tool.

`proj-cli` is a minimal, low-friction personal tool built for Maniteja. It is not an enterprise workspace framework or a disposable toy. It exists to solve concrete daily workstation friction across project navigation, temporary experimentation, local Git safety, and agent rules enforcement.

## Core purpose
Cut down repetitive terminal commands when working with repositories on Windows across PowerShell, CMD, and VS Code. Moving between an experimental scratchpad, a permanent grouped repository, and a remote GitHub repository requires single commands without manual folder navigation or repeated Git setup.

## Four core priorities: UX, DX, AX, and EX

### User experience (UX)
- Fast short commands (`proj cd`, `proj new`, `proj scratch`, `proj checkpoint`, `proj undo`).
- Automatic screen clearing (`Clear-Host` in PowerShell, `cls` in CMD) on successful project jumps.
- Interactive terminal dashboard when running `proj` with no arguments or `--interactive`.
- Zero-storage Desktop Directory Junction linking `~/Desktop/Projects` directly to canonical storage.

### Developer experience (DX)
- Single-depth project groups (`projects/<group>/<project>`) keeping repositories organized without deep directory nesting.
- Atomic file-based IPC tokens for directory jumps (`cd`) and editor launches (`code`).
- One-command private GitHub repository creation and remote pushing (`proj publish`).
- External project adoption into the canonical folder structure (`proj adopt`).

### Agent experience (AX)
- Every scaffolded project automatically receives master agent instructions (`AGENTS.md`).
- Strict test isolation, boundary validation in `RULES.md`, and clean seams so coding agents do not pollute the host or assume wrong paths.
- Built-in verification harnesses (`verify-proj-cli`) to test CLI workflows inside temporary directories.

### Execution experience (EX)
- Fast startup times, immediate exits, and clean text output.
- Non-blocking checks backed by local file cache TTLs.
- Atomic file writes that prevent corrupted configuration during unexpected process exits.

## Safety and experimentation model
- Disposable scratchpads. Create time-boxed temporary projects (`proj scratch`) with configurable expiration, extension, and graduation paths (`proj graduate`).
- Git safety net. Save checkpoint commits (`proj checkpoint`) and revert cleanly (`proj undo`). Reverts automatically create safety stashes (`proj-safety-stash-<timestamp>`) so uncommitted work is never lost.
- Self-healing diagnostics. `proj doctor --fix` detects and repairs broken configuration, missing templates, broken junctions, and outdated shell wrappers.

## Current status and roadmap
- Current state: Core engines complete (scaffolding, resolution, 1-level groups, scratchpad lifecycle, Git safety net, doctor diagnostics, terminal dashboard, adoption, GitHub publishing, verification harness).
- Completed in this cycle: Terminal auto-clear on project jump (`Clear-Host` and `cls`) and doctor wrapper synchronization for PowerShell and CMD (Issues #57, #59, #60).
- Next up: Native self-update engine (`SPEC-SELF-UPDATE-ENGINE.md`, Issue #56) to check upstream releases with a 24-hour cache TTL and update global npm installations or git clones.
