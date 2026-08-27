# Single-Depth Project Groups

## Context

Developers need to organize related repositories (such as hackathon entries, Web MCP spikes, client work, or exercise courses) into semantic folders under the workspace root (`projects/`) without losing CLI navigation, auto-discovery, or safety operations.

We considered two primary structures:
1. **Arbitrary multi-tier recursive nesting**: Allowing arbitrary folder trees (e.g. `projects/hackathons/2026/team-a/agent`).
2. **Strict single-level project groups**: Restricting categorization to a single directory level under the root (`projects/<group>/<project>`).

## Decision

We chose **strict single-level project groups** (`projects/<group>/<project>`) alongside standalone root projects (`projects/<project>`). Throwaways are kept flat in `projects/throwaways/<name>`.

## Consequences

- **Predictable Discovery & Lookup**: Shell navigation (`proj cd <name>`) and discovery (`listProjects`) perform deterministic, bounded filesystem scans with simple collision resolution.
- **Clean Empty Folder Pruning**: Parent group folders can be safely auto-pruned upon deleting their last contained project without needing recursive directory walk heuristics.
- **Separation of Concerns**: Temporary scratchpads remain in the flat throwaways directory, preventing stale group containers from lingering when time-boxed scratchpads expire.
