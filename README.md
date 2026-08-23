# proj (`proj-cli`)

> Modern TypeScript CLI for developer workspace organization, time-boxed disposable throwaways, and local offline Git safety nets for AI pair programming.

`proj` organizes your software development ecosystem into a clean, canonical workspace. It pairs a **Desktop Junction** with a **PowerShell Shell Bridge**, provides disposable **Throwaway Scratchpads** with automated Time-To-Live (TTL) tracking, and enforces an offline **Local Git Safety Net** (milestone checkpoints and safety stashes) designed for human and AI-assisted workflows.

---

## Features

- 📁 **Canonical Workspace & Desktop Junction**: Keep your Windows Desktop 100% clean while retaining instant drag-and-drop Windows Explorer access via an NTFS directory junction (`Desktop\Projects` -> `~/projects`).
- ⚡ **Seamless Host Shell Navigation**: Built-in PowerShell IPC bridge automatically navigates your active shell (`Set-Location`) and launches editors (`code`) directly from CLI commands and interactive selections.
- 🧪 **Time-Boxed Throwaway Scratchpads**: Spin up disposable experiments with an automated expiration lifespan (TTL in days). Interactively graduate successful experiments into permanent projects, extend their lifetime, or prune expired ones.
- 🛡️ **Offline Local Git Safety Net**: Save instant milestone checkpoints (`proj checkpoint "..."`) and perform non-destructive rollbacks (`proj undo`). Automatically generates emergency safety stashes before resetting, preventing data loss during breaking agent edits.
- 🤖 **AI Agent Guardrails & Hygiene**: Scaffolds starter templates (`minimal`, `typescript`, `python`, `web`) pre-configured with universal secret-shielding `.gitignore` files and customized `AGENTS.md` TDD instructions.
- 🎛️ **Interactive Clack TUI Dashboard**: Beautiful terminal user interface powered by `@clack/prompts` to inspect repositories, trigger rollbacks, manage throwaways, and self-heal configuration issues.
- 🩺 **System Diagnostics & Self-Healing**: `proj doctor --fix` automatically inspects and repairs broken Desktop junctions, configuration directories, and Git prerequisites.

---

## Architecture Overview

```
+-------------------------------------------------------------------------------+
|                             WINDOWS DESKTOP                                   |
|   [ Projects ] (NTFS Directory Junction)                                      |
+---------------------------------------+---------------------------------------+
                                        | (Redirects at filesystem level)
                                        v
+-------------------------------------------------------------------------------+
|                       CANONICAL PROJECTS ROOT (`~/projects`)                  |
|                                                                               |
|   +-- my-app/                (Permanent Project + Git repo + AGENTS.md)       |
|   +-- api-service/           (Permanent Project + Git repo + AGENTS.md)       |
|   \-- throwaways/            (Disposable Scratchpads with TTL metadata)       |
|       +-- test-proto/        (Expires in 3 days)                              |
|       \-- spike-parser/      (Expires in 7 days)                              |
+-------------------------------------------------------------------------------+
                                        ^
                                        |  Managed by `proj` CLI
+---------------------------------------+---------------------------------------+
|                    USER CONFIGURATION (`~/.proj/`)                            |
|                                                                               |
|   +-- config.json            (Global settings & throwaway records)            |
|   +-- ipc.json               (Atomic navigation payload for shell bridge)     |
|   +-- proj.ps1               (PowerShell wrapper function)                    |
|   \-- templates/             (Master AGENTS.md & gitignore templates)         |
+-------------------------------------------------------------------------------+
```

---

## Prerequisites & Installation

### Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Git**: Installed and available in your `PATH`
- **Shell**: PowerShell 5.1 / PowerShell 7+ on Windows (IPC core is shell-agnostic)

### Installation

1. Clone the repository and navigate into the directory:
   ```powershell
   git clone https://github.com/Vudattumaniteja/proj-cli.git
   cd proj-cli
   ```

2. Install dependencies and compile the CLI binary:
   ```powershell
   npm install
   npm run build
   ```

3. Register `proj` globally:
   ```powershell
   npm link
   ```

4. Initialize user directories and Desktop junction:
   ```powershell
   proj doctor --fix
   ```

---

## PowerShell Profile Setup (Shell Bridge)

Because child CLI processes cannot directly modify the parent shell's working directory, `proj` uses an atomic file-based IPC token mechanism (`~/.proj/ipc.json`).

To enable seamless directory switching and editor opening in your active PowerShell session:

1. Open your PowerShell profile:
   ```powershell
   notepad $PROFILE
   ```
   *(If `$PROFILE` does not exist, create it with `New-Item -Path $PROFILE -ItemType File -Force`)*

2. Add the following line to the end of your profile:
   ```powershell
   . "$HOME\.proj\proj.ps1"
   ```

3. Reload your profile or restart your terminal:
   ```powershell
   . $PROFILE
   ```

Now whenever you create a project, jump to a repository, or exit an interactive menu, your active PowerShell shell will automatically `Set-Location` directly into that folder!

---

## CLI Command Reference

### 1. Workspace Projects

#### `proj list` (alias: `proj ls`)
Lists all permanent projects and active throwaways in a formatted table with Git branch, dirty status, uncommitted changes count, and template badges.
```powershell
proj list
proj list --json
```

#### `proj new [name]` (alias: `proj create`)
Scaffolds a new permanent project with starter files, universal `.gitignore`, `AGENTS.md` guardrails, and an initial Git checkpoint commit.
```powershell
proj new my-service -t typescript
proj new my-script -t python
proj new
# -> Launches interactive wizard if name is omitted
```
**Options**:
- `-t, --template <template>`: Starter template (`minimal`, `typescript`, `python`, `web`). Default: `minimal`.
- `-i, --interactive`: Force interactive template wizard.

#### `proj adopt <folder-path>`
Moves an unmanaged external directory from anywhere on disk (e.g., Desktop or Downloads) into the canonical projects root, equips it with Git version control, universal `.gitignore`, and `AGENTS.md` rules.
```powershell
proj adopt "C:\Users\Manit\Desktop\legacy-project"
proj adopt "C:\Users\Manit\Downloads\api-spike" --name "my-adopted-api"
```
**Options**:
- `-n, --name <name>`: Specify a custom destination project name.

#### `proj code [name]`
Emits an IPC token to open a named project or the current working directory in VS Code.
```powershell
proj code my-service
proj code
```

---

### 2. Disposable Throwaway Scratchpads

Throwaways are temporary directories created under `~/projects/throwaways` for spikes and experiments, tagged with an expiration TTL (Time-To-Live).

#### `proj scratch [name]` (alias: `proj throwaway`)
Creates a new time-boxed throwaway scratchpad.
```powershell
proj scratch regex-spike --ttl 3 -t typescript
proj scratch quick-poc
```
**Options**:
- `-t, --template <template>`: Starter template (`minimal`, `typescript`, `python`, `web`). Default: `minimal`.
- `--ttl <days>`: Lifespan in days before expiration (default: 3 days).
- `-i, --interactive`: Launch interactive scratchpad creation wizard.

#### `proj extend <name> [days]`
Extends the expiration TTL of an active throwaway scratchpad.
```powershell
proj extend regex-spike 5
# -> Extends expiration by 5 additional days
```

#### `proj graduate <name>`
Promotes a throwaway experiment into a permanent project in the canonical projects root with full Git tracking.
```powershell
proj graduate regex-spike
```

#### `proj delete-throwaway <name>` (aliases: `rm-scratch`, `rm-throwaway`)
Deletes a throwaway scratchpad folder from disk and cleans up its tracking metadata.
```powershell
proj delete-throwaway regex-spike
```

#### `proj expired` (alias: `prune-expired`)
Inspects or batch prunes throwaway scratchpads whose expiration timestamp has passed.
```powershell
proj expired
proj expired --delete
# -> Batch deletes all expired scratchpads
```

---

### 3. Local Git Safety Net (Checkpoints & Rollbacks)

`proj` provides a completely offline, local-first safety net designed for both human developers and autonomous AI pair-programming agents.

#### `proj checkpoint [message]` (alias: `proj save`)
Stages all changes in the current Git repository and creates a local milestone commit prefixed with `checkpoint:`.
```powershell
proj checkpoint "implemented user authentication middleware"
proj checkpoint
# -> Defaults to "checkpoint: manual checkpoint"
```

#### `proj checkpoints` (alias: `proj history`)
Lists the recent milestone checkpoints in the current repository with commit hashes and relative timestamps.
```powershell
proj checkpoints
proj checkpoints -n 15
proj checkpoints --json
```
**Options**:
- `-n, --limit <number>`: Maximum number of checkpoints to retrieve.
- `--json`: Output checkpoint history in machine-readable JSON.

#### `proj undo [target]` (alias: `proj rollback`)
Safely reverts the repository working tree back to a previous checkpoint.
- **Safety Stash Guarantee**: If uncommitted or untracked changes exist in your working tree, `proj undo` automatically saves an emergency stash named `proj-safety-stash-<timestamp>` before executing `git reset --hard`.
- If `target` is omitted in an interactive terminal, launches an interactive selector displaying the last 15 checkpoints.
```powershell
proj undo
proj undo HEAD~1
proj undo a1b2c3d
proj undo -i
```

---

### 4. Configuration, Rules & Diagnostics

#### `proj rules [action]`
Inspect or edit the global master `AGENTS.md` conventions template located in `~/.proj/templates/AGENTS.md`.
```powershell
proj rules view
proj rules edit
# -> Opens master rules template in VS Code
```

#### `proj doctor`
Runs comprehensive diagnostic checks against your development environment and configuration.
```powershell
proj doctor
proj doctor --fix
proj doctor --json
```
**Diagnostic Checks**:
- Git binary availability in system `PATH`.
- Projects canonical root existence (`~/projects`).
- Throwaways root existence (`~/projects/throwaways`).
- Desktop NTFS Junction status (`Desktop\Projects` -> `~/projects`).
- User configuration directory and template files (`~/.proj/`).
- PowerShell wrapper script integrity (`~/.proj/proj.ps1`).

---

## Interactive TUI Dashboard

Typing `proj` with no arguments in any interactive terminal opens the Clack TUI Dashboard:

```
? proj - Developer Workspace & Git Safety Net
  > 📁 View & Switch Projects
    ✨ Create New Project
    🧪 Create Throwaway Scratchpad (TTL)
    ⏪ Rollback Git Checkpoint (Undo)
    📥 Adopt External Folder
    📜 View / Edit Agent Guardrails
    🩺 Run System Doctor (Diagnostics)
    🚪 Exit
```

- **Startup Expired Throwaway Prompt**: If any throwaways have expired since your last session, `proj` notifies you on startup and prompts you to **Graduate**, **Extend (+3d)**, or **Delete** them immediately.
- **Context Actions**: Within project inspection, directly jump into directories, launch VS Code, graduate throwaways, or delete discarded experiments.

---

## Development & Testing

This project is built with TypeScript, ESM, Vitest, and tsup following Test-Driven Development (TDD) principles.

```powershell
# Run the full test suite (180+ tests)
npm test

# Run tests in watch mode
npm run test:watch

# Run TypeScript typecheck
npm run typecheck

# Build standalone distribution bundles
npm run build
```

---

## License

MIT © [Vudattumaniteja](https://github.com/Vudattumaniteja)
