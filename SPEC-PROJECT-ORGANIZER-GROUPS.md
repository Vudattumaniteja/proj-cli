# Specification: Project Organizer & Subfolder Grouping

## Problem Statement

As developers participate in hackathons, work on specialized topic clusters (such as Web MCP agents, AI spikes, client contracts, or course exercises), their workspace projects directory (`~/projects`) becomes crowded with dozens of disparate repositories. 

Currently, `proj-cli` only supports a flat single-level directory structure under `~/projects` alongside a dedicated `throwaways` folder. Developers cannot organize related permanent repositories into semantic subfolders (such as `projects/hackathons/*` or `projects/web-mcp/*`) without losing CLI navigation (`proj cd`), editor launching (`proj code`), discovery (`proj list`), milestone checkpoints (`proj checkpoint`), or interactive TUI management.

## Solution

Extend `proj-cli` with a **Project Organizer & Subfolder Grouping** system:
1. **1-Level Semantic Grouping**: Support grouping projects inside category folders under canonical workspace root (`projects/<group>/<project>`) alongside root standalone projects (`projects/<project>`).
2. **Path-Based & Auto-Resolving CLI**: Enable `proj new <group>/<project>`, `proj cd <group>/<project>` or fast jump `proj cd <project>` (auto-searching across all groups with collision handling).
3. **Interactive Drill-Down TUI Browser**: Provide a folder exploration dashboard in the Clack TUI where developers can browse group folders, enter a group to view and manage its projects, create projects directly inside groups, and move projects between groups.
4. **Lifecycle & Cleanliness Automation**: Auto-clean empty group directories when the last project is deleted, and retain flat structure for time-boxed throwaway scratchpads.

---

## User Stories

1. As a developer, I want to create a project inside a specific category group folder (e.g. `proj new hackathons/agent-bot`) so that all my hackathon projects are grouped together in one folder.
2. As a developer, I want `proj-cli` to automatically create the parent group folder if it doesn't already exist so that I don't have to manually run `mkdir`.
3. As a developer, I want to run `proj list` and see my projects cleanly organized by group sections so that I can easily scan my workspace by category.
4. As a developer, I want `proj list --json` to include the `group` property in each project's metadata so that automation tools and scripts can filter by group.
5. As a developer, I want to type `proj cd agent-bot` and have `proj` automatically find `projects/hackathons/agent-bot` so that I can jump into my project quickly without typing the full group path.
6. As a developer, I want `proj cd` to prompt me with a selection list if multiple projects share the same name across different groups so that I always jump to the intended project.
7. As a developer, I want to type `proj cd hackathons` and have my terminal shell navigate to the `projects/hackathons` group directory so that I can inspect the entire group folder.
8. As a developer, I want to type `proj code hackathons/agent-bot` or `proj code agent-bot` to launch VS Code directly at the grouped project folder.
9. As a developer, I want to open the interactive TUI (`proj`) and see a **Project Organizer & Browser** menu that lists my group folders and standalone projects.
10. As a developer, I want to click on a group folder in the TUI (e.g. `📁 Hackathons (3 projects)`) to drill down and see only the projects inside that group.
11. As a developer, I want to create a new project directly from inside the group view in the TUI so that the new project is automatically assigned to that group.
12. As a developer, I want to select a project in the TUI and choose `📦 Move to Another Group / Root` so that I can reorganize existing projects without breaking Git tracking.
13. As a developer, I want to create a new group folder directly from the TUI dashboard so that I can set up categories before creating projects.
14. As a developer, I want `proj delete hackathons/agent-bot` to delete the project and automatically remove `projects/hackathons` if it is left empty so that my workspace stays clean.
15. As a developer, I want `proj publish hackathons/agent-bot` to default the GitHub repository name to `agent-bot` with an option to customize it so that remote repo names remain clean.
16. As a developer, I want throwaway scratchpads (`proj scratch`) to remain in the flat `projects/throwaways` folder so that temporary experiments don't clutter my project groups.
17. As a developer, I want the Windows Desktop Junction (`Desktop/Projects`) to seamlessly reflect the grouped subfolders without requiring extra junctions.
18. As a developer, I want all safety mechanisms (`proj checkpoint`, `proj undo`, dirty-state deletion checks) to function identically for grouped projects.

---

## Implementation Decisions

### 1. Workspace Domain & Hierarchy Model
- **Root Projects**: `C:\Users\<User>\projects\<project>` (`group: null` / `undefined`).
- **Grouped Projects**: `C:\Users\<User>\projects\<group>\<project>` (`group: string`, e.g. `'hackathons'`).
- **Nesting Depth**: Exactly 1 level of group folders under `projectsRoot`. Arbitrary deep recursive nesting is prevented to avoid ambiguous resolution and path traversal.
- **Reserved Folder Names**: `throwaways`, `.git`, `.proj`, `node_modules`, `dist` are excluded from being treated as group folders.

### 2. Discovery & Inspection Engine
- `inspectProject` in `src/engine/discovery.ts` is updated to accept an optional `group` parameter and attach `group?: string` to `ProjectInfo`.
- `listProjects` scans `projectsRoot`:
  - Standalone directories containing marker files or `.git` are registered as root projects.
  - Directories containing subdirectories with projects/Git repositories are scanned as group folders.
- `listGroups(canonicalRoot, options)` returns an array of `GroupInfo` objects (`{ name: string, path: string, projectCount: number, projects: ProjectInfo[] }`).
- `resolveProject(nameOrPath, canonicalRoot)` provides deterministic resolution:
  - Exact relative path matching (`hackathons/agent-bot`).
  - Standalone name matching (`agent-bot`).
  - Ambiguity detection returning all matching paths when duplicates exist across groups.
  - Group folder matching (`hackathons`).

### 3. Project Scaffolding & Group Operations Engine
- `scaffoldProject` in `src/engine/scaffold.ts` accepts `group?: string` or parses `group/name` format, ensuring the group folder is created and initializing the Git repo inside `projectsRoot/<group>/<name>`.
- `moveProject(sourcePathOrName, targetGroup | null)` in `src/engine/organize.ts` safely moves project folders between root and groups, validating target availability and maintaining Git integrity.
- `createGroup(groupName)` and `deleteGroup(groupName)` provide dedicated group lifecycle management.
- `deleteProject` in `src/engine/delete.ts` checks if the deleted project was inside a group folder, and if that group folder contains no other files or directories, automatically prunes the empty group directory.

### 4. CLI Command-Line Interface
- `proj new [name]` accepts `[group]/[name]` syntax.
- `proj cd [name]` and `proj code [name]` resolve names across root and all groups, emitting IPC tokens for shell navigation or editor launch. If a collision is found in headless mode, prints an error listing the ambiguous options.
- `proj list` outputs grouped sections with headers (`[hackathons]`, `[web-mcp]`, `[root]`).
- `proj move <project> <target-group>` moves an existing project to a group (or `root` to move out).

### 5. Interactive Clack TUI Dashboard & Project Organizer
- **Main Dashboard**: Menu option updated to `📂 Project Organizer & Browser`.
- **Top-Level Organizer Menu**: Displays:
  - Group folders with project counts: `📁 Hackathons (3 projects)`
  - Standalone root projects: `📄 personal-blog [typescript] (✔ clean)`
  - Action items: `➕ Create New Group Folder`, `↩ Back to Main Dashboard`
- **Group Drill-Down Screen**:
  - Lists projects in the group with Git badges and template info.
  - Action items: `✨ Create New Project in "<Group>"`, `🚀 Jump to Group Folder (cd)`, `📦 Rename / Delete Group`, `↩ Back to Groups`.
- **Project Action Menu**: Adds `📦 Move to Another Group / Root` option.
- **Interactive Project Creation Wizard**: Prompts user for destination (`📁 Root (standalone)`, an existing group, or `➕ Create New Group...`).

---

## Testing Decisions

### 1. Test Quality & Seams
- **Primary Seams**:
  - `src/engine/discovery.ts` (`listProjects`, `listGroups`, `resolveProject`)
  - `src/engine/scaffold.ts` (`scaffoldProject`)
  - `src/engine/organize.ts` (`moveProject`, `createGroup`, `deleteGroup`)
  - `src/engine/delete.ts` (`deleteProject` with empty group auto-pruning)
  - `src/index.ts` (CLI commands `new`, `cd`, `code`, `list`, `move`)
  - `src/tui/index.ts` (Interactive navigation and actions)
- **Isolation Rules**: All tests execute against temporary isolated directories created via `fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-...'))` with clean `afterEach` teardown and mocked `process.env.PROJ_CONFIG_DIR`.

### 2. Prior Art in Codebase
- `test/discovery.test.ts`, `test/scaffold.test.ts`, `test/delete.test.ts`, `test/cli.test.ts`, `test/tui.test.ts`.

---

## Out of Scope

- Recursive multi-tier sub-groups beyond 1 level (e.g. `projects/hackathons/2026/team-a/demo`).
- Group-level Git monorepos (each project remains an independent Git repository).
- Cloud GitHub team synchronization for groups.
- Throwaway scratchpad grouping.

---

## Further Notes

- Existing Windows Desktop Junction (`Desktop\Projects` -> `projects`) requires zero changes because Windows Explorer naturally exposes all group subdirectories.
