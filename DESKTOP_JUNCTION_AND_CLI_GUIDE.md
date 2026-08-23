# Understanding Windows Directory Junctions & The Terminal Jump System

This guide explains how **Directory Junctions** and the **PowerShell Terminal Jump System** work together to keep your Desktop 100% clean while giving you instant access to your code projects and disposable throwaways.

---

## 1. What is an NTFS Directory Junction?

In Windows, a **Directory Junction** (created via `New-Item -ItemType Junction` or `mklink /J`) is a filesystem-level pointer.

```
+-------------------------------------------------------------+
|                     YOUR WINDOWS DESKTOP                    |
|                                                             |
|   [ Projects ] (Directory Junction)                         |
+---------+---------------------------------------------------+
          |
          |  (Redirects transparently at the NTFS filesystem level)
          v
+-------------------------------------------------------------+
|               C:\Users\Manit\projects\                      |
|                                                             |
|   +-- sandcastle/                                           |
|   +-- video-pipeline/                                       |
|   +-- antigravity-mcp-server/                               |
|   +-- throwaways/ (time-boxed scratchpads with TTL)         |
+-------------------------------------------------------------+
```

### Why is this better than putting folders on the Desktop?
1. **Zero Desktop Bloat**: Your Desktop stays clean. The junction icon is just a tiny pointer.
2. **Native Windows Explorer Integration**: When you double-click `Projects` on your Desktop, Windows treats it exactly like a real folder. You can drag and drop files, open them in VS Code or Cursor, or copy files in and out.
3. **No File Duplication**: It takes 0 additional disk space because it points directly to the real files in `C:\Users\Manit\projects\`.
4. **Path Consistency**: All your terminal agents, Python virtual environments, and Node modules live in the standard path `C:\Users\Manit\projects\...`, avoiding path issues with OneDrive or Desktop sync.

---

## 2. What is the Terminal Jump System (`proj`)?

When you work in the terminal with AI agents like Antigravity, Claude Code, or Codex, navigating folders manually is slow:
```powershell
# The slow way:
cd C:\Users\Manit\projects\sandcastle
```

The **Terminal Jump System** uses a lightweight PowerShell IPC bridge (`. ~/.proj/proj.ps1`) to seamlessly jump directories in your active shell when commands or interactive selections complete.

### How You Use It:

### 1. Interactive Clack Dashboard (Typing `proj` alone)
If you type `proj` without arguments in an interactive terminal, `proj` launches an interactive TUI dashboard:
- View and switch between active repositories and throwaway scratchpads.
- Create new projects from templates (`minimal`, `typescript`, `python`, `web`).
- Create time-boxed throwaways with automated TTL tracking.
- Rollback broken agent edits using interactive milestone selection.
- Run doctor diagnostics and repair missing Desktop junctions.

### 2. Instant Project Scaffolding (`proj new <name>`)
```powershell
proj new my-awesome-tool -t typescript
```
This automatically:
1. Creates `C:\Users\Manit\projects\my-awesome-tool`
2. Injects starter template files and universal `.gitignore` (blocking secrets, keys, `.env`, and logs)
3. Injects `AGENTS.md` with agent guardrails and TDD rules
4. Initializes Git and creates an initial checkpoint snapshot commit
5. Switches your active PowerShell shell directly into the new project!

### 3. Disposable Throwaway Scratchpads (`proj scratch <name>`)
```powershell
proj scratch quick-poc --ttl 3
```
- Creates an isolated scratchpad in `C:\Users\Manit\projects\throwaways\quick-poc`.
- Sets a 3-day expiration timer.
- Prompts you on expiration to **Graduate** (promote to permanent project), **Extend** (+3 days), or **Delete**.

---

## 3. The Local Git Safety Model (Checkpoints & Rollbacks)

With local Git initialized in every project, you have a built-in safety net for AI pair programming:

| Action | Command | What It Does |
| :--- | :--- | :--- |
| **Save Checkpoint** | `proj checkpoint "added auth logic"` | Creates an instant local Git milestone snapshot (`checkpoint: added auth logic`). |
| **View History** | `proj checkpoints` | Lists recent milestone checkpoints with hashes and relative timestamps. |
| **Undo / Rollback** | `proj undo` | Stashes any dirty changes to `proj-safety-stash-<timestamp>` and resets back to the previous or selected checkpoint. |
| **System Diagnostics**| `proj doctor --fix` | Verifies and self-heals the Desktop junction, configuration directories, and Git availability. |

No cloud connection or GitHub account is needed for any of this—it is 100% private, instant, and local on your machine.
