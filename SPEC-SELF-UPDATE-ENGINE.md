# Specification: Self-Update Engine

## Problem Statement

Developers using the `proj` CLI across multiple machines and terminal sessions currently have no automated or built-in mechanism to know when new releases or updates have been pushed to the upstream GitHub repository (`Vudattumaniteja/proj-cli`). Users must manually check GitHub commits or run manual package commands to stay up to date, leading to outdated CLI binaries, missed bug fixes, and configuration drift.

## Solution

A native Self-Update Engine embedded in the `proj` CLI that:
1. Automatically checks for newer versions in the background with a 24-hour cache TTL by fetching the upstream manifest (`package.json`) without hitting GitHub API rate limits.
2. Emits a non-intrusive Update Notification when a newer version is available.
3. Provides an explicit `proj update` (alias: `proj upgrade`) command that handles both global npm installations and local Git development clones.
4. Integrates version freshness checks into the interactive dashboard (TUI banner and menu option) and system diagnostics (`proj doctor`).

## User Stories

1. As a developer using `proj`, I want the CLI to automatically detect when a newer version has been published upstream on GitHub, so that I am always aware of available enhancements and bug fixes.
2. As a developer, I want update checks to be cached locally with a 24-hour Time-to-Live (TTL), so that my daily CLI commands remain fast without adding network latency on every execution.
3. As a developer, I want the CLI to fetch the raw upstream `package.json` manifest, so that version checks succeed reliably without consuming unauthenticated GitHub REST API rate limits.
4. As a developer, I want to see a clear, non-intrusive Update Notification in my terminal when a newer version is detected, so that I know an update is available without my active workflow being interrupted.
5. As a developer, I want to run `proj update` or `proj upgrade`, so that the CLI automatically installs the latest release.
6. As a developer, I want to run `proj update --check`, so that I can dry-run check for updates and see version comparisons without initiating an installation.
7. As a developer, I want to run `proj update --force`, so that I can bypass the 24-hour cache and force an immediate recheck and reinstallation.
8. As a developer maintaining `proj` locally, I want `proj update` to detect if I am running from a local Git repository clone, so that it runs `git pull && npm run build` instead of overwriting my local development link with a global npm package.
9. As a developer launching the interactive TUI (`proj`), I want to see an update badge in the dashboard header when a new release is available, so that I have immediate visual feedback.
10. As a developer in the interactive TUI, I want an "Update proj CLI" menu option, so that I can upgrade the CLI with a single selection without leaving the interactive interface.
11. As a developer running `proj doctor`, I want a diagnostic check that reports my current version against the upstream GitHub version, so that I can verify my installation freshness alongside local workspace health.
12. As a developer experiencing network loss during an upgrade, I want the installation failure to be handled cleanly with the previous installation left intact, so that my existing CLI binary is never left corrupted.

## Implementation Decisions

- **Self-Update Engine Module**: Build a dedicated engine module responsible for upstream version querying, local cache management in `config.json`, and upgrade execution.
- **Cache Persistence & Schema**: Extend the workspace configuration schema to track an `updateCheck` record containing `lastChecked` (timestamp in ms), `latestVersion` (string), and optional configuration flags.
- **Manifest Discovery**: Query the raw GitHub repository content URL (`https://raw.githubusercontent.com/Vudattumaniteja/proj-cli/main/package.json`) to parse the remote `version` field and compare it against the running local version using semantic versioning.
- **Dual Execution Strategy**:
  - For global npm installations: Execute `npm install -g git+https://github.com/Vudattumaniteja/proj-cli.git`.
  - For local Git repository clones: Detect presence of local Git repository and execute `git pull && npm run build`.
- **Non-Blocking Notification Hook**: Run an asynchronous, non-blocking check hook on CLI entry/exit that compares the local version against the cached `latestVersion` and prints a formatted notification if stale.
- **Interactive TUI & Doctor Integration**: Add the update check status badge to the Clack TUI header and doctor check suite.

## Testing Decisions

- **Seams**: Test exclusively at public engine seams (`checkUpdate`, `performUpdate`, `formatUpdateNotification`) and CLI command parsing seams (`proj update`, `proj doctor`).
- **Network Isolation**: Mock HTTP requests to the upstream GitHub manifest URL to simulate newer versions, equal versions, older versions, and network timeouts.
- **Process Isolation**: Mock `execa` calls for `npm install` and `git pull` to test command arguments, success states, and failure recovery.
- **Filesystem Safety**: Run all config and cache tests against isolated temporary directories created with `fs.mkdtempSync`.
- **Prior Art**: Follow the testing patterns in `test/publish.test.ts` and `test/doctor.test.ts`.

## Out of Scope

- Silent background auto-installation without user awareness or confirmation.
- Direct binary patching / self-modifying binary replacement without npm or git.
- Multiple release channels (such as canary or nightly) beyond the canonical repository release.

## Further Notes

- Maintains atomic installation semantics through standard package manager behavior.
- Fully compatible with Windows PowerShell and CMD IPC wrappers.
