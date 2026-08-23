## Problem Statement

When building software projects and pair programming with AI coding agents (such as Antigravity, Claude Code, and Codex), developers frequently create ad-hoc prototype folders directly on the Windows Desktop. Over time, this workflow causes significant friction:
1. **Desktop Clutter & Fragmentation**: Loose folders scatter across the Desktop without a single canonical source of truth, making project discovery and organization cumbersome.
2. **Missing Local Version Control**: Experimental code is frequently written without Git tracking or initialized repositories, leaving no audit trail or safety net.
3. **Agent Regression Risks & Data Loss**: AI agents often make sweeping modifications across multiple files that introduce subtle bugs or break working features. Without a clean, zero-friction rollback mechanism, restoring working state is painful or impossible.
4. **Repetitive Setup Overhead**: Initializing every new project requires manually writing comprehensive `.gitignore` files to block secrets/environment files, defining agent instruction guardrails (`AGENTS.md`), and creating initial commits.
5. **Throwaway Script Accumulation**: Disposable 5-minute test scripts and scratchpads linger on disk indefinitely because there is no automated time-to-live (TTL) expiration or graduation lifecycle.

## Solution

A dedicated, high-performance TypeScript CLI tool (`proj`) and PowerShell integration that provides an offline-first local workspace manager and local Git safety net:
1. **Canonical Storage & Clean Desktop**: All persistent repositories reside in a centralized Canonical Project Root (`C:\Users\<User>\projects\`), accessible effortlessly from Windows Explorer and the Desktop via a zero-overhead NTFS Directory Junction (`Desktop\Projects`).
2. **Interactive TUI Dashboard & Fast Navigation**: Typing `proj` launches an interactive terminal interface displaying primary actions and a nested project browser showing active Git branches, uncommitted change counts, template badges, and last-modified dates.
3. **PowerShell IPC Bridge**: An IPC token mechanism bridges child CLI processes to the host PowerShell environment, enabling seamless in-terminal directory changes (`Set-Location`) and direct editor launching.
4. **Automated Project Scaffolding (`proj new`)**: An interactive wizard and CLI flags that scaffold project templates (Minimal, TypeScript, Python, Web), inject universal secret-shielding `.gitignore` files, supply customized AI agent rules (`AGENTS.md`), initialize local Git, and create an initial commit snapshot.
5. **Throwaway Scratchpad Lifecycle (`proj throwaway` & `proj graduate`)**: Time-boxed scratchpads with configurable TTLs (e.g., 1 day, 3 days, 7 days) and automated startup prompts to graduate, extend, or delete expired experiments.
6. **Loose Folder Adoption (`proj adopt`)**: A safe migration command that moves loose desktop folders into the managed projects directory and equips them with Git shields.
7. **Local Save-Game Checkpoints & Rollbacks (`proj checkpoint` & `proj undo`)**: Instant offline Git milestone commits and safe rollbacks that automatically capture emergency backup stashes (`proj-safety-stash-<timestamp>`) before any hard reset.
8. **Master Guardrails & Rules Customization (`proj rules`)**: Direct commands to inspect and edit master `AGENTS.md` and `.gitignore` templates in the code editor.
9. **System Diagnostics & Self-Healing (`proj doctor`)**: Automated checks that validate Git configurations, canonical directories, and auto-repair broken Desktop Junctions.

## User Stories

1. As a developer, I want to type `proj` in my terminal, so that I am greeted with a clean, interactive TUI menu of workspace actions.
2. As a developer, I want the root interactive menu to keep top-level choices clean by nesting the repository list inside a dedicated "View & Jump to Projects" option.
3. As a developer, I want to browse through all my existing repositories in an interactive list, so that I can see their active Git branch, dirty state, template type, and last modified date.
4. As a developer, I want to select a project from the interactive list, so that my active terminal automatically changes directory into that project folder.
5. As a developer, I want to trigger a project action to open it in VS Code, so that I can start editing without manually finding the folder path.
6. As a developer, I want to run `proj new <name>`, so that I can quickly scaffold a new project with minimal friction.
7. As a developer, I want `proj new` to offer starter templates (Minimal, TypeScript, Python, Web), so that I don't have to write boilerplate for different stacks.
8. As a developer, I want every newly scaffolded project to automatically receive a comprehensive `.gitignore`, so that secrets (`.env`, API keys), virtual environments, dependencies, and temporary agent logs are never tracked.
9. As a developer, I want every newly scaffolded project to automatically receive an `AGENTS.md` file, so that AI coding agents immediately respect codebase guidelines and commit conventions.
10. As a developer, I want `proj new` to automatically run `git init` and commit the initial files, so that version control is active from the very first second.
11. As a developer, I want to run `proj throwaway <name>`, so that I can create an isolated sandbox project that doesn't clutter my permanent project list.
12. As a developer, I want `proj throwaway` to prompt for an expiration duration (e.g., 1 day, 3 days, 7 days), so that temporary code has an explicit lifespan.
13. As a developer, I want the CLI to detect expired throwaway scratchpads on launch, so that I am prompted to delete them, extend their expiration, or graduate them.
14. As a developer, I want to run `proj graduate <name>`, so that I can promote a successful throwaway experiment into a permanent, Git-tracked project in the canonical projects root.
15. As a developer, I want to run `proj adopt <folder-path>`, so that I can migrate an existing loose folder into the canonical projects directory and equip it with Git and agent safety files.
16. As a developer, I want to run `proj checkpoint "<message>"`, so that all current working tree changes are committed as a local milestone snapshot.
17. As an AI coding agent, I want to execute `proj checkpoint "<message>"` upon completing a task, so that verified working code is safely preserved.
18. As a developer, I want to run `proj undo` (or `proj rollback`), so that I can restore my codebase to a previous checkpoint when an agent makes breaking changes.
19. As a developer, I want `proj undo` to automatically create a named Git safety stash before resetting the working tree, so that I never lose uncommitted manual work by accident.
20. As a developer, I want `proj undo` to display an interactive list of recent checkpoints, so that I can choose which milestone to roll back to.
21. As a developer, I want to run `proj rules edit`, so that my master `AGENTS.md` template opens in VS Code for quick editing of default agent instructions.
22. As a developer, I want to run `proj rules view`, so that I can print the current active agent guardrails directly to the terminal.
23. As a developer, I want to run `proj doctor`, so that the CLI verifies Git availability, projects directory existence, and the health of the Desktop Junction.
24. As a developer, I want `proj doctor --fix` (or an interactive prompt) to automatically recreate or repair broken Desktop Junctions, so that Explorer access remains seamless.
25. As a developer, I want to run `proj code [name]`, so that I can open the current folder or a named workspace project directly in VS Code from any terminal location.
26. As a developer, I want to run `proj list` (with optional `--json` flag), so that I can view a non-interactive, scriptable table or machine-readable list of all projects and metadata.
27. As a developer, I want all Git actions to operate 100% locally and offline, so that I am never forced to authenticate to GitHub or push code to remote cloud repositories for local safety.

## Implementation Decisions

1. **Architecture & CLI Framework**:
   - Built with TypeScript targeting Node.js (Node >= 20).
   - Bundled with `tsup` into a standalone CLI executable entrypoint (`dist/index.js`) registered under the binary alias `proj`.
   - Command routing and CLI arguments parsed via `commander`.
   - Terminal interactive UX and menus built using `@clack/prompts`.
   - Git operations orchestrated using programmatic child-process execution (`execa` / `simple-git`).

2. **Filesystem Layout & Domain Constants**:
   - Canonical Projects Root: `C:\Users\<User>\projects`
   - Throwaway Root: `C:\Users\<User>\projects\throwaways`
   - Desktop Directory Junction: `C:\Users\<User>\Desktop\Projects` -> `C:\Users\<User>\projects`
   - User Configuration & Storage Directory: `~/.proj/`
     - `~/.proj/config.json`: Stores workspace settings, default templates, and throwaway metadata.
     - `~/.proj/ipc.json`: Ephemeral IPC token file for shell navigation bridge.
     - `~/.proj/templates/AGENTS.md`: Master AI agent rules template.
     - `~/.proj/templates/gitignore.default`: Universal secret & hygiene ignore rules.

3. **PowerShell IPC Bridge Pattern**:
   - Because a child Node.js process cannot directly modify the parent shell's working directory, `proj` emits navigation intents to `~/.proj/ipc.json` and optionally writes a distinct stdout token.
   - A lightweight PowerShell profile function intercepts the token and invokes `Set-Location <target>`, achieving instant in-shell navigation.
   ```typescript
   // Decision-rich IPC token shape (validated in prototype)
   interface IpcNavigationToken {
     action: 'cd' | 'code' | 'none';
     targetPath: string;
     timestamp: number;
   }
   ```

4. **Project Scaffolding & Template Engine**:
   - Supported starter templates:
     - `minimal`: Bare folder + `.gitignore` + `AGENTS.md` + `README.md`
     - `typescript`: `package.json`, `tsconfig.json`, `src/index.ts`, `.gitignore`, `AGENTS.md`, `README.md`
     - `python`: `pyproject.toml` / `requirements.txt`, `main.py`, `.gitignore`, `AGENTS.md`, `README.md`
     - `web`: Standard web starter assets + `.gitignore` + `AGENTS.md` + `README.md`
   - Scaffolding performs automatic `git init`, stages all generated files, and commits them with message: `checkpoint: Initial commit with agent guardrails & gitignore`.

5. **Local Git Safety & Rollback Engine**:
   - Checkpoints are saved with commit messages prefixed by `checkpoint: <message>`.
   - When rolling back (`proj undo`), the engine checks for uncommitted/untracked changes and creates an emergency safety stash named `proj-safety-stash-<timestamp>` before executing `git reset --hard <hash>`.
   - Rollback displays the last 15 checkpoint commits for interactive selection.

6. **Throwaway State Management & Lifecycle**:
   - Scratchpad metadata is persisted in `~/.proj/config.json`:
   ```typescript
   // Decision-rich schema from prototype
   interface ThrowawayRecord {
     name: string;
     path: string;
     createdAt: string; // ISO 8601 string
     expiresAt: string; // ISO 8601 string
     template: string;
   }
   ```
   - On interactive launch, `checkExpiredThrowaways()` evaluates `Date.now() > Date.parse(record.expiresAt)`. If expired records exist, it prompts the user with `[Graduate | Extend (+3d) | Delete]`.

7. **Desktop Junction Diagnostics & Self-Healing**:
   - `proj doctor` inspects whether `Desktop\Projects` exists, verifies it is a valid NTFS Junction targeting the canonical projects root via `fs.lstatSync` / PowerShell `Get-Item`, and offers automated recreation if invalid or missing.

## Testing Decisions

1. **Testing Philosophy**:
   - Tests verify external behavior, filesystem outcomes, Git state changes, and IPC emission rather than private implementation details.
   - All tests execute against isolated sandbox fixtures in a temporary directory tree (e.g. `tmpdir/test-workspace/`) to guarantee safety and reproducibility without modifying real user repositories.

2. **Proposed Testing Seams**:
   - **Primary Seam (Domain Engine Layer)**: Unit and integration tests directly exercising the domain service functions (`scaffoldProject`, `createThrowaway`, `graduateThrowaway`, `adoptFolder`, `createCheckpoint`, `rollbackCheckpoint`, `checkExpiredThrowaways`, `verifyJunction`, `repairJunction`) using Vitest. This single deep seam covers >90% of business logic and edge cases.
   - **Secondary Seam (CLI End-to-End Execution)**: CLI process integration tests invoking the compiled binary with simulated argument arrays via `execa` to verify command parsing, exit codes, IPC token generation, and stdout formatting.

3. **Prior Art & Test Coverage**:
   - Behavioral test suites in TypeScript CLI ecosystems using Vitest and temporary filesystems.
   - Simulated Git repository fixtures initialized in `os.tmpdir()` for Git checkpoint and stash assertions.

## Out of Scope

1. Automatic synchronization or mandatory push/pull with remote cloud hosts (GitHub / GitLab) â€” all Git safety operations remain strictly local.
2. Cloud-hosted multi-developer collaboration dashboards.
3. Complex interactive 3-way merge conflict editors (developers are directed to standard Git when non-trivial rebase or merge conflicts occur).
4. Custom shell wrappers for shells other than PowerShell (e.g. Bash/Zsh) in the initial Windows-focused release, though IPC design remains shell-agnostic.

## Further Notes

- Global registration is performed via `pnpm link --global` / `npm link`.
- A doctor command (`proj doctor`) is accessible at any time to verify system health and repair broken junctions.
