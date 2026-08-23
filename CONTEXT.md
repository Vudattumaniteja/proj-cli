# Workspace & Local Git Safety Net

A local workspace orchestrator and offline Git safety system for managing permanent repositories, disposable scratchpads, and rapid milestone recovery during AI-assisted development.

## Language

### Workspace & Storage

**Projects Root**:
The single persistent directory on disk designated as the canonical home for all permanent repositories.
_Avoid_: Root folder, workspace root, project directory, codebase folder

**Desktop Junction**:
An NTFS directory junction on the Desktop linking directly to the projects root to provide file manager access without desktop clutter.
_Avoid_: Desktop shortcut, desktop folder, projects symlink, desktop link

**Project**:
A distinct, permanent software codebase residing inside the projects root and tracked by a local Git repository.
_Avoid_: Repository folder, codebase, repo directory

**Starter Template**:
A predefined set of configuration and boilerplate starter files used to initialize a new project according to its technology stack.
_Avoid_: Boilerplate, scaffold preset, project skeleton, archetype

### Scratchpad Lifecycle

**Throwaway**:
A temporary, disposable workspace directory created for short-lived experiments and governed by an expiration lifespan.
_Avoid_: Sandbox, spike, scratchpad, temp project, throwaway project

**Time-to-Live (TTL)**:
The lifespan in days assigned to a throwaway before it is flagged as expired.
_Avoid_: Expiration duration, lifespan, expiry window, retention period

**Graduation**:
The promotion of an experimental throwaway into a permanent, Git-tracked project within the projects root.
_Avoid_: Promotion, conversion, finalizing, hardening

**Adoption**:
The migration and onboarding of an unmanaged external directory into the projects root, equipping it with standard ignore rules and version control.
_Avoid_: Ingestion, import, onboarding, folder claiming

### Git Safety Net

**Checkpoint**:
A local milestone commit capturing working tree changes with a standardized prefix to serve as a verified save point.
_Avoid_: Savepoint, milestone commit, agent commit, snapshot

**Rollback**:
The restoration of the repository working tree to a previously recorded checkpoint.
_Avoid_: Revert, undo, rewind, reset

**Safety Stash**:
An automatically created Git stash of uncommitted or untracked changes generated immediately prior to executing a rollback.
_Avoid_: Emergency stash, backup stash, auto-stash, temp stash

**Agent Guardrails**:
A set of committed repository instructions and conventions that constrain AI coding agents operating within the project.
_Avoid_: Agent rules, system instructions, AI guidelines, prompt rules

### System Integration

**Shell Bridge**:
The inter-process communication mechanism that passes navigation intents from CLI processes to the host shell.
_Avoid_: IPC bridge, terminal hook, shell wrapper, cd proxy

**Diagnostics & Self-Healing**:
The automated verification and corrective repair of workspace prerequisites, directory structures, and junction links.
_Avoid_: Doctor check, system health, environment repair, sanity check
