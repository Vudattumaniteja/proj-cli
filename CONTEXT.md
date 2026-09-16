# Workspace and project lifecycle management

Developer workspace management, project hierarchy, throwaway scratchpad lifecycle, and local Git safety net engine.

## Language

### Workspace hierarchy

**Canonical Projects Root**:
The primary directory (`~/projects` or `C:\Users\<User>\projects`) holding all permanent developer projects and project groups.
_Avoid_: Workspace root, code folder, repo root

**Project Group**:
A 1-level category directory residing directly inside the Canonical Projects Root that groups related permanent projects together (for example, `projects/hackathons/`).
_Avoid_: Sub-project, category folder, sub-workspace, tag, nested repo

**Standalone Project**:
A permanent Git-tracked project repository located directly under the Canonical Projects Root without a parent group.
_Avoid_: Root project, ungrouped project, top-level repo

**Grouped Project**:
A permanent Git-tracked project repository located inside a Project Group.
_Avoid_: Sub-project, child project, nested project

**Throwaways Root**:
A dedicated directory (`~/projects/throwaways`) containing time-boxed experimental scratchpad projects with automated expiration.
_Avoid_: Sandbox directory, temp folder, playground

**Desktop Junction**:
A zero-storage Windows directory junction linking the user Desktop to the Canonical Projects Root for direct workspace access.
_Avoid_: Shortcut, symlink, desktop folder

### Navigation and discovery

**Project Organizer**:
The interactive drill-down explorer and management workflow for navigating, categorizing, creating, and relocating projects across groups.
_Avoid_: File manager, workspace browser, project manager

**Navigation Token**:
A short-lived IPC JSON payload emitted by the CLI that instructs the parent shell wrapper to execute terminal jumps (`cd`) or editor launches (`code`).
_Avoid_: IPC command, shell trigger, jump signal

### Shell bridge and terminal integration

**Terminal Auto-Clear**:
The execution of `Clear-Host` in PowerShell or `cls` in CMD immediately after the shell successfully shifts location to the resolved project directory.
_Avoid_: Screen wipe, reset, clear console, terminal flush

**Shell Wrapper**:
The parent shell script (`~/.proj/proj.ps1` for PowerShell) or batch script (`~/.proj/proj.cmd` or `%APPDATA%\npm\proj.cmd` for CMD) that runs the CLI, reads `ipc.json`, changes directory in the host shell process, and clears the screen on jump.
_Avoid_: Shell hook, alias script, runner script, shims

**Wrapper Synchronization**:
The diagnostic check and automated update mechanism inside `proj doctor --fix` that detects outdated shell wrappers lacking auto-clear logic and rewrites them with the latest templates.
_Avoid_: Wrapper update, script patch, shell repair

### Git safety net and lifecycle

**Milestone Checkpoint**:
A Git commit prefixed with `checkpoint:` created before risky code modifications or experiment spikes.
_Avoid_: Quick commit, savepoint, snapshot

**Safety Stash**:
An automated Git stash (`proj-safety-stash-<timestamp>`) created before destructive rollback operations to prevent loss of uncommitted work.
_Avoid_: Backup stash, emergency stash

**Scratchpad**:
A temporary, isolated project directory assigned a strict Time-to-Live (TTL) after which it is flagged for pruning or graduation.
_Avoid_: Throwaway project, test repo, spike folder

**Graduation**:
The promotion of an active scratchpad from the Throwaways Root into a permanent Standalone Project or Grouped Project.
_Avoid_: Project promotion, scratchpad export, permanent conversion

### Self-update and version lifecycle

**Self-Update Engine**:
The subsystem responsible for detecting remote releases, caching check timestamps, and applying CLI package updates.
_Avoid_: Auto-updater, package updater, patcher

**Update Check Interval**:
The configured cache duration (default: 24 hours) between background queries to GitHub for newer versions.
_Avoid_: Poll interval, update frequency, refresh rate

**Update Notification**:
The non-blocking notification displayed after command execution or in the terminal banner when a newer version is detected upstream.
_Avoid_: Update alert, upgrade warning, popup
