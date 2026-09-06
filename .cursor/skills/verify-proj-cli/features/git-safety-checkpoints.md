# Git Safety Checkpoints and Undo

Git Safety Checkpoints and Undo provides an atomic save-game system for local Git repositories. It allows developers to create milestone checkpoint commits before risky code edits, inspect checkpoint history, and safely rollback working tree state to a prior checkpoint while automatically creating a named safety stash to prevent uncommitted data loss.

## Sub-features

- `checkpoint-save` stages changes and creates an atomic Git commit prefixed with `checkpoint: <message>`.
- `checkpoint-list` retrieves recent milestone checkpoints in formatted tabular or JSON format.
- `checkpoint-undo` resets the working tree to a target checkpoint commit and automatically stashes uncommitted changes into `proj-safety-stash-<timestamp>`.

## How to get to it (user POV)

- Run `proj checkpoint [message]` or `proj save [message]` in a Git repo to record a checkpoint.
- Run `proj checkpoints` or `proj checkpoints --json` to list recent checkpoints.
- Run `proj undo [target]` or `proj rollback [target]` to revert to a previous checkpoint.

## Driving it with harness

Preconditions:

- `dist/index.js` is built and doctor passes.
- A Git repository exists inside the sandbox workspace.

- **Create checkpoint.** Inside repo directory, modify a file and run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- checkpoint "initial experiment"`. Exit code `0` and stdout reports `Successfully created checkpoint <hash> ("checkpoint: initial experiment")`.
- **List checkpoints.** Query recent checkpoints. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- checkpoints --json`. Exit code `0` and stdout returns a JSON array containing checkpoint objects with `hash`, `shortHash`, `message`, and `timestamp`.
- **Modify and Rollback.** Make uncommitted breaking edits, then run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- undo HEAD`. Exit code `0` and stdout displays the rollback summary. The reverted file is restored to its exact checkpoint state, and dirty modifications are safely preserved in a Git stash.
- **Capture proof.** Save transcript and checkpoint list JSON to `artifacts/verify-proj-cli/git-safety-checkpoints/`.

## Gotchas

- Running `proj checkpoint` on a clean working tree with no changes fails with a descriptive error.
- Running checkpoint commands outside a Git repository fails with an error.
- `proj undo` with no argument rolls back to the immediate previous checkpoint commit.
