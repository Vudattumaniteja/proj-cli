import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  getConfig,
  getTemplatesDir,
  DEFAULT_AGENTS_TEMPLATE,
  DEFAULT_GITIGNORE_TEMPLATE,
  DEFAULT_AGENTS_TEMPLATE_NAME,
  DEFAULT_GITIGNORE_TEMPLATE_NAME,
} from '../config/index.js';
import {
  SUPPORTED_TEMPLATES,
  type ProjectTemplate,
  type ScaffoldOptions,
  type ScaffoldResult,
} from './types.js';

export * from './types.js';

/**
 * Validates project name format and prevents path traversal / invalid chars.
 */
export function validateProjectName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Invalid project name: project name cannot be empty');
  }

  const trimmed = name.trim();
  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`Invalid project name "${name}": cannot be "." or ".."`);
  }

  // Check for forbidden filesystem characters
  const invalidCharRegex = /[/\\:*?"<>|]/;
  if (invalidCharRegex.test(trimmed)) {
    throw new Error(
      `Invalid project name "${name}": contains forbidden characters (/ \\ : * ? " < > |)`
    );
  }
}

/**
 * Validates template identifier against supported list.
 */
export function validateTemplate(template: string): asserts template is ProjectTemplate {
  if (!SUPPORTED_TEMPLATES.includes(template as ProjectTemplate)) {
    throw new Error(
      `Invalid or unsupported template "${template}". Supported templates: ${SUPPORTED_TEMPLATES.join(', ')}`
    );
  }
}

/**
 * Generates starter project files for the specified template variant.
 */
export function generateTemplateFiles(
  projectPath: string,
  name: string,
  template: ProjectTemplate,
  options?: ScaffoldOptions
): string[] {
  const createdFiles: string[] = [];

  const writeFile = (relPath: string, content: string) => {
    const fullPath = path.join(projectPath, relPath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    createdFiles.push(relPath);
  };

  // 1. Universal .gitignore
  let gitignoreContent = DEFAULT_GITIGNORE_TEMPLATE;
  const templatesDir = getTemplatesDir(options?.configDir);
  const customGitignorePath = path.join(templatesDir, DEFAULT_GITIGNORE_TEMPLATE_NAME);
  if (fs.existsSync(customGitignorePath)) {
    try {
      gitignoreContent = fs.readFileSync(customGitignorePath, 'utf8');
    } catch {
      gitignoreContent = DEFAULT_GITIGNORE_TEMPLATE;
    }
  }
  writeFile('.gitignore', gitignoreContent);

  // 2. AGENTS.md guardrails & conventions
  let agentsContent = DEFAULT_AGENTS_TEMPLATE;
  const customAgentsPath = path.join(templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME);
  if (fs.existsSync(customAgentsPath)) {
    try {
      agentsContent = fs.readFileSync(customAgentsPath, 'utf8');
    } catch {
      agentsContent = DEFAULT_AGENTS_TEMPLATE;
    }
  }
  writeFile('AGENTS.md', agentsContent);

  // 3. Template-specific files
  switch (template) {
    case 'minimal': {
      writeFile('README.md', `# ${name}\n\nMinimal starter project.\n`);
      break;
    }

    case 'typescript': {
      const packageJson = {
        name,
        version: '0.1.0',
        description: `${name} TypeScript project`,
        type: 'module',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        scripts: {
          build: 'tsc',
          test: 'node --test',
        },
        devDependencies: {
          typescript: '^5.7.0',
        },
      };
      writeFile('package.json', JSON.stringify(packageJson, null, 2) + '\n');

      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          outDir: './dist',
        },
        include: ['src/**/*'],
      };
      writeFile('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n');

      const indexTs = `export function hello(name: string = '${name}'): string {
  return \`Hello, \${name}!\`;
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  console.log(hello());
}
`;
      writeFile('src/index.ts', indexTs);
      writeFile('README.md', `# ${name}\n\nTypeScript starter project.\n`);
      break;
    }

    case 'python': {
      const pyproject = `[project]
name = "${name}"
version = "0.1.0"
description = "${name} Python project"
readme = "README.md"
requires-python = ">=3.10"
dependencies = []
`;
      writeFile('pyproject.toml', pyproject);

      const mainPy = `def main() -> None:
    print("Hello from ${name}!")


if __name__ == "__main__":
    main()
`;
      writeFile('main.py', mainPy);
      writeFile('requirements.txt', `# ${name} dependencies\n`);
      writeFile('README.md', `# ${name}\n\nPython starter project.\n`);
      break;
    }

    case 'web': {
      const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>${name}</h1>
      <p>Web starter project</p>
    </main>
    <script type="module" src="main.js"></script>
  </body>
</html>
`;
      writeFile('index.html', indexHtml);

      const styleCss = `:root {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.5;
}

body {
  margin: 0;
  padding: 2rem;
}
`;
      writeFile('style.css', styleCss);

      const mainJs = `console.log('App initialized: ${name}');\n`;
      writeFile('main.js', mainJs);

      const packageJson = {
        name,
        version: '0.1.0',
        type: 'module',
      };
      writeFile('package.json', JSON.stringify(packageJson, null, 2) + '\n');
      writeFile('README.md', `# ${name}\n\nWeb starter project.\n`);
      break;
    }
  }

  return createdFiles;
}

/**
 * Scaffolds a new project from a starter template, initializes Git, and creates the first milestone commit.
 */
export async function scaffoldProject(
  name: string,
  template: ProjectTemplate,
  options?: ScaffoldOptions
): Promise<ScaffoldResult> {
  validateProjectName(name);
  validateTemplate(template);

  const trimmedName = name.trim();

  // Resolve target directory path
  let parentDir: string;
  if (options?.parentDir) {
    parentDir = path.resolve(options.parentDir);
  } else {
    const config = getConfig({ configDir: options?.configDir });
    parentDir = path.resolve(config.projectsRoot);
  }

  const projectPath = path.join(parentDir, trimmedName);

  if (fs.existsSync(projectPath)) {
    throw new Error(`Project "${trimmedName}" already exists at ${projectPath}`);
  }

  // Ensure parent directory exists
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Create project directory
  fs.mkdirSync(projectPath, { recursive: true });

  // Generate template files
  const files = generateTemplateFiles(projectPath, trimmedName, template, options);

  // Initialize local Git repository and create snapshot commit
  const git = simpleGit(projectPath, { maxConcurrentProcesses: 2 });
  await git.init();

  // Configure local user info if needed to guarantee commit creation across all environments
  await git.addConfig('user.name', options?.gitAuthorName || 'proj-agent', false, 'local');
  await git.addConfig('user.email', options?.gitAuthorEmail || 'agent@proj.local', false, 'local');

  // Stage and commit all files
  await git.add('.');
  await git.commit('checkpoint: Initial commit with agent guardrails & gitignore');

  const commitHash = (await git.revparse(['HEAD'])).trim();

  return {
    name: trimmedName,
    path: projectPath,
    template,
    commitHash,
    files,
  };
}
