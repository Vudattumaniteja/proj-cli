# AGENTS.md

## Agent Guidelines & Standards

### Core Execution Rule
- **Always read [RULES.md](file:///C:/Users/Manit/projects/clearing%20out%20the%20trash/RULES.md) before planning, running commands, or implementing features.** Follow all test isolation, boundary validation, and architecture rules defined there.

### Development Workflow & TDD
- Always follow Test-Driven Development (TDD) using the Red-Green-Refactor loop.
- Write tests at public seams and boundaries rather than testing private internals.
- Verify behavior against isolated temporary directories or mocks.
- Ensure all test suites (`npm test`), type checks (`npm run typecheck`), and builds (`npm run build`) pass cleanly before committing.

### Code Style & Module Design
- Use modern ESM syntax (`import`/`export`).
- Strict TypeScript: no implicit `any`, handle nullable types explicitly.
- Modular, deep functions with minimal, clear interfaces.
- Conventional commits referencing issue numbers (e.g. `feat(core): ... (#8)`).

