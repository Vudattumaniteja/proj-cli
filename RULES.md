# RULES.md

## Core Engineering & Execution Rules

### 1. Test Isolation & Environment Safety
- Never run tests or diagnostics against live host paths (`~/Desktop`, `%APPDATA%`, `~/.proj`).
- Always run tests and scaffolding against isolated temporary directories created with `fs.mkdtempSync(path.join(os.tmpdir(), ...))`.
- Always clean up temporary directories in `afterEach` or `finally` blocks.
- Mock all environment variables (`process.env.PROJ_CONFIG_DIR`) and restore them cleanly after test completion.

### 2. Root Cause Fixes Over Defensive Layering
- Fix data errors, schema mismatches, and parsing issues at the boundary (such as `src/config/index.ts`), not by adding speculative search loops in consuming modules.
- Never guess or speculate on runtime environment strings (e.g. entrypoint filenames, fictional binary paths). Inspect actual values passed by the runtime.
- Eliminate copy-pasted logic into shared, well-tested helper functions.

### 3. Strict Verification & Quality Gates
- Follow Test-Driven Development (TDD): write or update tests before modifying implementation code.
- Every commit must pass all test suites (`npm test`), type checking (`npm run typecheck`), and the build step (`npm run build`).
- Strict TypeScript: no implicit or explicit `any`. Handle nullable types explicitly.
- Never rely on string-only matching (`toContain`, regex) to verify shell scripts, batch files, or IPC wrappers. Any wrapper that alters navigation, environment variables, or shell state must be tested by executing inside a real shell subprocess (`cmd.exe`, `powershell.exe`) and asserting post-execution working directories and exit codes.


### 4. Architectural Invariants & Spec Integrity
- Consult `CONTEXT.md` before adding or altering core CLI commands, IPC schemas, or data models.
- Maintain atomic IPC operations (`writeAtomicFileSync`) for shell bridge stability.
- Ensure cross-platform path handling normalizes Windows backslashes, drive letters, and long-path prefixes (`\\?\`).
