# CONTEXT.md

## Project Overview
`proj-cli` (`proj`) is a high-performance TypeScript CLI tool designed for developer workspace management, project scaffolding, throwaway scratchpad lifecycle management, and a local Git safety net (milestone checkpoints, zero-loss rollbacks, emergency stashes) on Windows and cross-platform environments.

## Core Concepts & Domain Model
1. **Canonical Projects Root**: `C:\Users\<User>\projects` (or `~/projects` on POSIX). Holds all permanent Git-tracked projects.
2. **Throwaways Root**: `C:\Users\<User>\projects\throwaways`. Holds time-boxed experimental scratchpads with configurable TTLs (e.g. 1, 3, 7 days).
3. **Desktop Directory Junction**: `C:\Users\<User>\Desktop\Projects` -> `C:\Users\<User>\projects`. Provides zero-storage overhead Windows Explorer drag-and-drop access to workspace projects.
4. **Configuration & State Directory**: `~/.proj/`
   - `config.json`: Configuration options, custom settings, and throwaway scratchpad metadata.
   - `ipc.json`: Ephemeral navigation tokens (`{ action: 'cd' | 'code' | 'none', targetPath: string, timestamp: number }`) consumed by PowerShell profile bridge.
   - `templates/`: AI agent rules (`AGENTS.md`) and `.gitignore.default`.
5. **Local Git Safety Engine**:
   - `proj checkpoint [msg]`: Creates commit with prefix `checkpoint: <message>`.
   - `proj undo [hash]`: Pre-creates safety stash `proj-safety-stash-<timestamp>` before resetting to prevent loss of uncommitted work.

## Technology Stack
- **Runtime**: Node.js >= 20 (ES2022 / NodeNext ESM)
- **Language**: TypeScript (Strict Mode)
- **Bundler**: `tsup` (generating standalone executable `dist/index.js` with shebang)
- **Test Runner**: `vitest`
- **CLI Utilities**: `commander`, `@clack/prompts`, `simple-git`, `execa`, `picocolors`
