# Project Adoption and IPC Navigation

Project Adoption and IPC Navigation handles bringing existing external folders into the canonical workspace structure, safely deleting projects with working tree safety checks, and communicating with the parent shell profile bridge via atomic IPC tokens to execute directory jumps (`cd`) and editor launches (`code`).

## Sub-features

- `adopt-folder` imports an external directory into `projectsRoot`, initializes Git if absent, and creates guardrails.
- `delete-project` deletes a project from `projectsRoot` (requiring clean working tree or `-f` force flag).
- `jump-cd` resolves target project path and emits an atomic `cd` navigation token to `ipc.json`.
- `open-code` resolves target project path and emits an atomic `code` navigation token to `ipc.json`.

## How to get to it (user POV)

- Run `proj adopt <folder-path> [-n <name>]` to import an external directory.
- Run `proj delete <name> [-f]` to delete a project.
- Run `proj cd [name]` to navigate the shell to a project or workspace root.
- Run `proj code [name]` to open a project in VS Code.

## Driving it with harness

Preconditions:

- `dist/index.js` is built and doctor passes.
- An isolated sandbox exists.

- **Adopt external folder.** Create an external folder with sample files. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- adopt <external-folder> -n adopted-app`. Exit code `0` and stdout reports `Successfully adopted project "adopted-app"`. Directory `projects/adopted-app` exists with `.git` initialized.
- **Emit IPC jump token.** Jump to `adopted-app`. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- cd adopted-app`. Exit code `0` and stdout reports `Jumping to project "adopted-app"`. File `.proj/ipc.json` contains `{"action": "cd", "target": "<path>/projects/adopted-app"}`.
- **Delete project.** Delete `adopted-app`. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- delete adopted-app -f`. Exit code `0` and stdout reports `Successfully deleted project "adopted-app"`. Directory `projects/adopted-app` is removed.
- **Capture proof.** Save transcript and IPC token JSON to `artifacts/verify-proj-cli/adoption-and-navigation/`.

## Gotchas

- Deleting a project with uncommitted changes fails unless `-f` (`--force`) is provided.
- IPC tokens are written atomically using temporary files and rename operations to avoid race conditions with shell hooks.
- Ambiguous project names (e.g. same name across multiple groups) cause `proj cd` and `proj code` to fail with exit code 1 and list all matching paths.
