# Project Scaffolding and Groups

Project Scaffolding and Groups lets a user initialize new Git-tracked project repositories with standard agent guardrails (`AGENTS.md`, `.gitignore`), organize projects inside category subfolders (groups), list all discovered projects in tabular or JSON formats, and relocate projects across groups.

## Sub-features

- `scaffold-standalone` creates a permanent Git repository in the root workspace with an initial commit and guardrails.
- `scaffold-grouped` creates a permanent Git repository nested inside a 1-level category group folder.
- `list-projects` lists all standalone and grouped projects and scratchpads in formatted tables or structured JSON.
- `move-project` relocates a project directory between the root workspace and category groups.

## How to get to it (user POV)

- Run `proj new <name> [-t <template>]` to scaffold a standalone project.
- Run `proj new <name> -g <group> [-t <template>]` to scaffold a grouped project.
- Run `proj list` or `proj list --json` to inspect all projects.
- Run `proj move <project> <target-group>` to move a project into a group or back to root (`""`).

## Driving it with harness

Preconditions:

- `dist/index.js` is built and doctor passes.
- An isolated sandbox exists with empty `projects/` root.

- **Scaffold standalone project.** Create a project named `alpha-web`. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- new alpha-web -t minimal`. Exit code `0` and stdout reports `Successfully created project "alpha-web"`. The directory `projects/alpha-web` contains `.git`, `AGENTS.md`, and `.gitignore`.
- **Scaffold grouped project.** Create a project named `beta-api` in group `backend`. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- new beta-api -g backend -t minimal`. Exit code `0` and stdout reports `Successfully created project "beta-api" at <path>/projects/backend/beta-api`. The directory `projects/backend/beta-api` contains `.git`.
- **List projects in JSON.** Query all discovered projects. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- list --json`. Exit code `0` and stdout returns a JSON array containing both `alpha-web` (with `group: null`) and `beta-api` (with `group: "backend"`).
- **Relocate project to new group.** Move `alpha-web` to group `frontend`. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- move alpha-web frontend`. Exit code `0` and stdout reports `Successfully moved project "alpha-web" to group "frontend"`. Directory `projects/frontend/alpha-web` exists and `projects/alpha-web` is removed.
- **Capture proof.** Save transcript and project list JSON into `artifacts/verify-proj-cli/scaffold-and-groups/`.

## Gotchas

- Scaffolding into an existing non-empty directory is rejected with an error to prevent data loss.
- Target group paths must not contain nested subdirectories (only 1-level groups supported).
- Moving a project to root requires passing empty string `""` as the target group.
