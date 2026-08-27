# Workspace & Project Lifecycle Management

Developer workspace management, project hierarchy, throwaway scratchpad lifecycle, and local Git safety net engine.

## Language

### Workspace Hierarchy

**Canonical Projects Root**:
The primary directory (`~/projects` or `C:\Users\<User>\projects`) holding all permanent developer projects and project groups.
_Avoid_: Workspace root, code folder, repo root

**Project Group**:
A 1-level category directory residing directly inside the Canonical Projects Root that groups related permanent projects together (e.g. `projects/hackathons/`).
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
A zero-storage Windows directory junction linking the user's Desktop to the Canonical Projects Root for drag-and-drop workspace access.
_Avoid_: Shortcut, symlink, desktop folder

### Navigation & Discovery

**Project Organizer**:
The interactive drill-down explorer and management workflow for navigating, categorizing, creating, and relocating projects across groups.
_Avoid_: File manager, workspace browser, project manager

**Navigation Token**:
An ephemeral IPC payload emitted by the CLI that instructs the parent shell profile bridge to execute terminal jumps (`cd`) or editor launches (`code`).
_Avoid_: IPC command, shell trigger, jump signal

### Git Safety Net & Lifecycle

**Milestone Checkpoint**:
An atomic save-game Git commit prefixed with `checkpoint:` created before risky code modifications or experiment spikes.
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
