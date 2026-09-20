---
name: verify-proj-cli
description: "Drive and verify proj-cli commands, project scaffolding, throwaway lifecycle, Git checkpoints, and doctor diagnostics in isolated sandboxes. Use for /verify-proj-cli, proving proj-cli behavior, or testing CLI features."
---

# Verify proj-cli

This skill drives and verifies the user-facing CLI commands and workflows of `proj-cli` without mutating the host machine's live workspace or configuration. Every test and verification run executes against an isolated sandbox directory in `os.tmpdir()`.

## Launch

`proj-cli` is a short-lived Node.js CLI application. There is no long-running daemon or background server to keep alive.

- **Build**: Run `npm run build` to compile TypeScript sources to `dist/index.js`.
- **Ready check**: `dist/index.js` exists and outputs help when executed via `node dist/index.js --help`.
- **Session model**: Each verification pass creates a fresh, isolated temporary sandbox directory containing a dedicated `.proj/config.json`, `projects/` root, `projects/throwaways/` root, and `Desktop/Projects` junction target. All commands are executed with `PROJ_CONFIG_DIR` pointing to the sandbox `.proj` directory.

```bash
# Build binary
npm run build

# Quick sanity check
node dist/index.js --help
```

## Doctor

Before driving features, verify the environment and build health:

```bash
node .agents/skills/verify-proj-cli/scripts/harness.mjs doctor
```

Doctor confirms:
1. Node.js runtime is version 20 or higher.
2. Build artifact `dist/index.js` exists and is non-empty.
3. Git executable is available on `PATH`.
4. Sandbox creation and isolated CLI execution succeed.

## Drive

Drive features through the verification harness or directly using `node dist/index.js` with `PROJ_CONFIG_DIR` set to an isolated directory.

### Driving with the Harness

```bash
# Run isolated command inside a disposable sandbox
node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- new my-app -t minimal
node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- list --json
node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- doctor --json

# Run end-to-end automated verification for all or specific features
node .agents/skills/verify-proj-cli/scripts/harness.mjs feature all
node .agents/skills/verify-proj-cli/scripts/harness.mjs feature scaffold
node .agents/skills/verify-proj-cli/scripts/harness.mjs feature throwaway
node .agents/skills/verify-proj-cli/scripts/harness.mjs feature checkpoints
node .agents/skills/verify-proj-cli/scripts/harness.mjs feature doctor
node .agents/skills/verify-proj-cli/scripts/harness.mjs feature adoption
```

### Manual Isolated Driving

```bash
# 1. Create temporary sandbox directory
# 2. Write sandbox config.json pointing projectsRoot and throwawaysRoot to sandbox paths
# 3. Execute command with PROJ_CONFIG_DIR pointing to sandbox .proj
PROJ_CONFIG_DIR=/path/to/sandbox/.proj node dist/index.js <command> [options]
```

## Evidence

Verification artifacts are saved to `artifacts/verify-proj-cli/<feature-name>/`:

- **CLI Transcripts (`transcript.txt`)**: Exact command invocations, exit codes, standard output, and standard error streams.
- **Structured Data (`*.json`)**: Output payloads from commands supporting `--json` (such as `list --json`, `checkpoints --json`, `doctor --json`, and IPC tokens `ipc.json`).
- **Filesystem Proof**: Asserted existence of generated Git repositories, commit history, configuration updates, and directory moves.

All proof artifacts survive sandbox cleanup and remain accessible for inspection.

## Cleanup

The harness automatically cleans up temporary directories and sandbox instances after execution. To clean stored verification artifacts:

```bash
node .agents/skills/verify-proj-cli/scripts/harness.mjs clean
```

Never delete host-level `~/projects` or `~/.proj`. Only sandboxes inside temporary directories (`os.tmpdir()`) are cleaned.

## Helpers

The verification harness is located at `.agents/skills/verify-proj-cli/scripts/harness.mjs`.

- `doctor`: Runs diagnostic health checks on the build, runtime, and git tooling.
- `exec -- <args>`: Spawns `proj-cli` with provided arguments inside an ephemeral isolated sandbox and prints output.
- `feature <name>`: Runs the full verification recipe for `scaffold`, `throwaway`, `checkpoints`, `doctor`, `adoption`, `wrappers`, or `all`.
- `clean`: Removes generated evidence files in `artifacts/verify-proj-cli/`.

## Feature Map

Consult the feature map in `features/README.md` for specific user stories and driving recipes:

- [Feature Map Index](./features/README.md)
- [Project Scaffolding and Groups](./features/scaffold-and-groups.md)
- [Throwaway Scratchpad Lifecycle](./features/throwaway-lifecycle.md)
- [Git Safety Checkpoints and Undo](./features/git-safety-checkpoints.md)
- [Doctor Diagnostics and Self-Healing](./features/doctor-and-diagnostics.md)
- [Project Adoption and IPC Navigation](./features/adoption-and-navigation.md)
