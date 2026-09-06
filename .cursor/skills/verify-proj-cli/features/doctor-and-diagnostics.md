# Doctor Diagnostics and Self-Healing

Doctor Diagnostics and Self-Healing inspects the configuration health of the developer workspace, verifies existence of canonical directories, checks external tool installations (Git, PowerShell), and repairs missing configuration files or templates automatically.

## Sub-features

- `doctor-check` executes non-mutating system diagnostics and outputs formatted issues or JSON reports.
- `doctor-fix` repairs missing directories, default configuration files, and default AGENTS.md templates.
- `init-workspace` initializes workspace directories, config, PowerShell bridge, and Desktop Junction via doctor fix.
- `rules-view` prints the global master AGENTS.md template rules to stdout.

## How to get to it (user POV)

- Run `proj doctor` or `proj doctor --json` to inspect configuration.
- Run `proj doctor --fix` to self-heal detected discrepancies.
- Run `proj init` to initialize workspace configuration.
- Run `proj rules view` to inspect master AGENTS.md template rules.

## Driving it with harness

Preconditions:

- `dist/index.js` is built and doctor passes.
- An isolated sandbox exists.

- **Run diagnostic check.** Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- doctor --json`. Exit code is `0` when clean or `1` when missing files are found, and stdout returns a structured JSON object with `checks`, `errorCount`, `warningCount`, and `isHealthy`.
- **Run self-healing repair.** Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- doctor --fix`. Exit code `0` and stdout reports repaired items and resulting health status.
- **View rules template.** Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- rules view`. Exit code `0` and stdout prints the master `AGENTS.md` content containing `# AGENTS.md`.
- **Capture proof.** Save transcript and doctor diagnostic report to `artifacts/verify-proj-cli/doctor-and-diagnostics/`.

## Gotchas

- `proj doctor` returns non-zero exit code if any error-level check fails.
- `proj rules edit` emits an IPC token to open the file in VS Code instead of printing to terminal.
