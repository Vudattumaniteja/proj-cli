# proj-cli

TypeScript command-line tool for local repository navigation, throwaway scratchpads, and Git safety on Windows.

## Setup and installation

### Global installation via npm

Install `proj-cli` globally from npm:

```bash
npm install -g proj-cli
```

After installation, initialize workspace folders, configuration, and shell scripts:

```bash
proj init
```

Running `proj init` creates `~/.proj`, generates default agent templates, builds the Desktop Directory Junction (`~/Desktop/Projects` linking to `~/projects`), and writes the shell wrapper scripts.

### Installation from source

Clone the repository and link it locally:

```bash
git clone https://github.com/Vudattumaniteja/proj-cli.git
cd proj-cli
npm install
npm run build
npm link
proj init
```

## Shell profile integration

A Node.js process runs as a child process and cannot alter the working directory of your running terminal shell. To change directories in your active terminal, `proj` emits an atomic JSON payload to `~/.proj/ipc.json`. A shell wrapper reads that file, changes your shell location, and deletes the token.

### PowerShell setup

Add this line to your PowerShell profile:

```powershell
if (Test-Path "$HOME\.proj\proj.ps1") { . "$HOME\.proj\proj.ps1" }
```

To locate or create your profile file, inspect `$PROFILE` in PowerShell:

```powershell
notepad $PROFILE
```

Save the file and restart PowerShell or reload the profile:

```powershell
. $PROFILE
```

### Windows Command Prompt (CMD) setup

The initialization command writes `~/.proj/proj.cmd` and updates `%APPDATA%\npm\proj.cmd`.

When you run `proj` in Command Prompt, Windows resolves `proj.cmd`. The batch script executes the Node CLI, extracts `targetPath` from `ipc.json`, runs `cd /d "%targetPath%"`, and deletes `ipc.json`.

Ensure `%USERPROFILE%\.proj` or `%APPDATA%\npm` exists in your system `PATH`.

## Terminal auto-clearing

When jumping to a project with `proj cd <project>`, the shell wrapper clears the screen after successfully changing directory.

PowerShell executes `Clear-Host` and Command Prompt executes `cls`.

```
[Before] C:\Users\Manit\projects\proj-cli> proj cd my-app
[After]  C:\Users\Manit\projects\my-app> (screen cleared, ready for work)
```

If directory navigation fails, such as when a target path does not exist, the wrapper skips clearing the screen. This preserves command output and error messages.

To verify that your installed wrappers include auto-clear logic, run:

```bash
proj doctor
```

If the doctor reports outdated wrappers, synchronize them:

```bash
proj doctor --fix
```

## Workspace organization and single-depth groups

`proj` organizes repositories under a single canonical root directory (`~/projects`).

```
~/projects/
  ├── my-tool/                     # Standalone project
  ├── web-client/                  # Standalone project
  ├── services/                    # Project group (1-level category)
  │   ├── auth-service/            # Grouped project
  │   └── billing-service/         # Grouped project
  └── throwaways/                  # Dedicated scratchpad root
      └── spike-auth/              # Active scratchpad
```

### Single-depth rule

Project groups group related repositories together under a single folder name. Groups are strictly one directory deep (`projects/<group>/<project>`).

Nested subgroups like `projects/a/b/c` are not permitted. This boundary keeps resolution fast and prevents disorganized folder trees.

### Desktop directory junction

Running `proj init` creates an NTFS directory junction at `~/Desktop/Projects` that points directly to `~/projects`. This provides immediate Desktop access to your workspace while consuming zero additional disk space.

## Throwaway scratchpad lifecycle

Scratchpads are disposable, time-boxed repositories designed for spikes and experiments. They live in `~/projects/throwaways` and carry a Time-to-Live (TTL).

### Create a scratchpad

To create an isolated experiment directory initialized with Git and an expiration date, run `proj scratch <name>`:

```bash
proj scratch spike-caching --ttl 3
```

This scaffolds `~/projects/throwaways/spike-caching`, initializes a Git repository, and records expiration metadata in `~/.proj/throwaways.json`. The default TTL is 7 days if omitted.

### Check expiration

To see remaining days on active scratchpads:

```bash
proj list
```

To list scratchpads that passed their expiration date:

```bash
proj expired
```

### Extend a scratchpad

To add more days to an active scratchpad:

```bash
proj extend spike-caching 5
```

This adds 5 days to the expiration date.

### Graduate to permanent storage

When an experiment succeeds, promote it into a permanent project repository:

```bash
proj graduate spike-caching
```

The CLI moves the directory from `~/projects/throwaways/spike-caching` to `~/projects/spike-caching`, retains all Git commit history, and cleans up throwaway tracking entries.

### Delete scratchpads

To delete a specific scratchpad:

```bash
proj delete-throwaway spike-caching
```

To delete all expired scratchpads in one command:

```bash
proj expired --delete
```

## Git safety net

`proj` includes a local safety net so you can test code changes without risking your working tree.

### Milestone checkpoints

To commit your current working tree state before trying an experimental change, run `proj checkpoint [message]`:

```bash
proj checkpoint "before updating vitest config"
```

The CLI stages all files and creates a commit formatted as `checkpoint: <message>`.

To inspect recent checkpoints in the current repository:

```bash
proj checkpoints
```

### Safe rollback with automated stashing

To revert your working tree back to a previous checkpoint, run `proj undo`:

```bash
proj undo
```

Before running `git reset --hard`, the CLI saves a Git stash named `proj-safety-stash-<timestamp>`. If you rollback by mistake, run `git stash list` and `git stash apply` to restore your uncommitted files.

To rollback to a specific commit:

```bash
proj undo a1b2c3d
```

To pick a checkpoint from an interactive menu:

```bash
proj undo -i
```

## Command reference

### Navigation and editor commands

- `proj cd [name]` (alias: `jump`)
  Change shell directory to target project, group, scratchpad, or workspace root.
  ```bash
  proj cd               # jump to canonical projects root (~/projects)
  proj cd my-tool       # jump to standalone project ~/projects/my-tool
  proj cd services/auth # jump to grouped project ~/projects/services/auth
  proj cd spike-caching # jump to active scratchpad ~/projects/throwaways/spike-caching
  ```

- `proj code [name]`
  Open target project, group, or current directory in VS Code.
  ```bash
  proj code             # open current directory in VS Code
  proj code my-tool     # open ~/projects/my-tool in VS Code
  ```

### Project scaffolding and management

- `proj new [name]` (alias: `create`)
  Scaffold a new project repository with Git tracking and agent rules (`AGENTS.md`).
  Options: `-t, --template <minimal|cli|agent>`, `-g, --group <group>`, `-i, --interactive`.
  ```bash
  proj new api-service
  proj new parser -g tools -t cli
  proj new -i
  ```

- `proj list` (alias: `ls`)
  List all standalone projects, grouped projects, and active scratchpads.
  Options: `--json`.
  ```bash
  proj list
  proj list --json
  ```

- `proj move <project> <target-group>` (alias: `mv`)
  Move a project into a group or back to the root workspace.
  ```bash
  proj move api-service backend    # moves to ~/projects/backend/api-service
  proj move api-service root       # moves back to ~/projects/api-service
  ```

- `proj adopt <folder-path>`
  Move an external folder into `~/projects`, initialize Git if missing, and add agent rules.
  Options: `-n, --name <name>`.
  ```bash
  proj adopt C:\Users\Manit\Downloads\legacy-tool -n legacy-tool
  ```

- `proj publish [name]`
  Create a private GitHub repository, set remote origin, and push current branch.
  ```bash
  proj publish                     # publish current repository
  proj publish my-tool             # publish ~/projects/my-tool
  ```

- `proj delete <name>` (alias: `rm`)
  Delete a project locally. Pass `--cloud` to delete the GitHub remote repository too.
  Options: `--cloud`, `-f, --force`.
  ```bash
  proj delete old-tool
  proj delete dead-service --cloud
  ```

### Scratchpad commands

- `proj scratch [name]` (alias: `throwaway`)
  Create a disposable scratchpad repository.
  Options: `-t, --template <minimal|cli|agent>`, `--ttl <days>`, `-i, --interactive`.
  ```bash
  proj scratch quick-poc --ttl 3
  ```

- `proj graduate <name>`
  Promote an active scratchpad to a permanent project in `~/projects`.
  ```bash
  proj graduate quick-poc
  ```

- `proj extend <name> [days]`
  Extend scratchpad TTL.
  ```bash
  proj extend quick-poc 4
  ```

- `proj delete-throwaway <name>` (alias: `rm-scratch`)
  Delete a scratchpad directory and tracking metadata.
  ```bash
  proj delete-throwaway quick-poc
  ```

- `proj expired` (alias: `prune-expired`)
  List expired scratchpads or delete them in batch.
  Options: `-d, --delete`, `--json`.
  ```bash
  proj expired
  proj expired --delete
  ```

### Git safety commands

- `proj checkpoint [message]` (alias: `save`)
  Create a local checkpoint commit.
  ```bash
  proj checkpoint "pre-refactor state"
  ```

- `proj checkpoints` (alias: `history`)
  List recent checkpoints in the current repository.
  Options: `-n, --limit <number>`, `--json`.
  ```bash
  proj checkpoints -n 10
  ```

- `proj undo [target]` (alias: `rollback`)
  Roll back to a checkpoint with automatic safety stashing.
  Options: `-i, --interactive`.
  ```bash
  proj undo
  proj undo 9f8e7d6
  ```

### Configuration and diagnostics

- `proj rules [action]`
  View or edit master `AGENTS.md` template in VS Code.
  ```bash
  proj rules view
  proj rules edit
  ```

- `proj doctor`
  Inspect system health across Git, workspace folders, Desktop Junction, configuration, and shell wrappers.
  Options: `-f, --fix`, `--json`.
  ```bash
  proj doctor
  proj doctor --fix
  ```

## Interactive dashboard

Run `proj` without arguments or pass `-i` to launch the interactive terminal dashboard:

```bash
proj
```

The interactive menu lets you navigate projects, scaffold repositories, manage scratchpads, revert checkpoints, adopt external folders, and run doctor repairs without typing subcommands.
