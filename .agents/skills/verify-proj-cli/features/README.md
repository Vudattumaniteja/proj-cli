# proj-cli verification map

This directory is the maintained source for verifying the user-facing behavior of `proj-cli`. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Node.js version is 20 or higher (`node -v`).
- Project is built with `npm run build`, producing `dist/index.js`.
- Git command line tool is installed and accessible on `PATH`.
- Every verification run executes inside an isolated sandbox with `PROJ_CONFIG_DIR` pointing to a temporary directory in `os.tmpdir()`.
- Never execute verification commands against live host paths (`~/projects` or `~/.proj`).
- Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs doctor` before driving features.

## Driving conventions

- Execute commands through `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- <command>` or the feature runner `harness.mjs feature <name>`.
- For direct CLI execution, always pass `PROJ_CONFIG_DIR` pointing to an isolated temporary sandbox.
- Treat every command as literal. Keep option flags and argument names exact.
- Capture stdout, stderr, exit codes, and JSON responses into the named artifact paths.
- Retain all proof artifacts in `artifacts/verify-proj-cli/` across sandbox cleanups.

## Proof and skip reporting

- CLI proof includes exact command string, exit code, stdout, stderr, and validated side-effects on disk.
- JSON output proof includes parsing and schema validation of returned objects or arrays.
- Filesystem proof includes inspecting `.git` initialization, config entries, `AGENTS.md` content, and directory moves.
- Report any unreachable path with the attempted command and the unmet precondition.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with harness` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Project Scaffolding and Groups](./scaffold-and-groups.md) covers standalone project creation, group subfolders, listing, and moving projects.
- [Throwaway Scratchpad Lifecycle](./throwaway-lifecycle.md) covers scratchpad creation with TTL, expiration extension, graduation, and pruning.
- [Git Safety Checkpoints and Undo](./git-safety-checkpoints.md) covers milestone checkpoints, history inspection, and safe rollback with automated safety stash.
- [Doctor Diagnostics and Self-Healing](./doctor-and-diagnostics.md) covers system health checks, automatic repair, and master rules viewing.
- [Project Adoption and IPC Navigation](./adoption-and-navigation.md) covers external folder adoption, deletion, and shell IPC tokens.
