export const PROJ_DIR_NAME = '.proj';
export const CONFIG_FILE_NAME = 'config.json';
export const IPC_FILE_NAME = 'ipc.json';
export const TEMPLATES_DIR_NAME = 'templates';
export const DEFAULT_AGENTS_TEMPLATE_NAME = 'AGENTS.md';
export const DEFAULT_GITIGNORE_TEMPLATE_NAME = 'gitignore.default';

export const DEFAULT_TTL_DAYS = 3;

export const DEFAULT_AGENTS_TEMPLATE = `# AGENTS.md

## Project Context & Coding Guidelines

- Follow Test-Driven Development (TDD): write unit/integration tests before writing implementation code.
- Write clean, modular, and typed TypeScript / JavaScript code.
- Keep functions focused and well-documented.
- Run tests and linters before committing.

## Milestone Commit Conventions
- Checkpoints must follow format: \`checkpoint: <message>\`.
- Standard development commits use conventional commits (e.g. \`feat: ...\`, \`fix: ...\`).
`;

export const DEFAULT_GITIGNORE_TEMPLATE = `# Dependencies
node_modules/
.pnp
.pnp.js
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
env/
ENV/

# Production / Build output
dist/
build/
out/
target/
*.egg-info/

# Logs & Agent artifacts
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*
*.log
.system_generated/
tasks/

# Environment & Secret shield
.env
.env.local
.env.*.local
*.pem
*.key
*.secret
*.token
id_rsa*

# Editor & OS files
.DS_Store
Thumbs.db
.idea/
.vscode/
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;
