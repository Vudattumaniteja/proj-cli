import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import {
  scaffoldProject,
  SUPPORTED_TEMPLATES,
  type ProjectTemplate,
} from '../src/engine/scaffold.js';
import { detectTemplateType } from '../src/engine/discovery.js';
import { ensureConfigDirs } from '../src/config/index.js';

describe('Project Scaffolding Engine', () => {
  let tempRoot: string;
  let projectsDir: string;
  let configDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-scaffold-'));
    projectsDir = path.join(tempRoot, 'projects');
    configDir = path.join(tempRoot, '.proj');
    fs.mkdirSync(projectsDir, { recursive: true });
    ensureConfigDirs({ configDir });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('Validation & Error Handling', () => {
    it('rejects empty or whitespace-only project name', async () => {
      await expect(
        scaffoldProject('', 'minimal', { parentDir: projectsDir, configDir })
      ).rejects.toThrow(/project name cannot be empty/i);

      await expect(
        scaffoldProject('   ', 'minimal', { parentDir: projectsDir, configDir })
      ).rejects.toThrow(/project name cannot be empty/i);
    });

    it('rejects invalid project name characters', async () => {
      const invalidNames = [
        'bad/name',
        'bad\\name',
        'bad:name',
        'bad*name',
        'bad?name',
        'bad"name',
        'bad<name',
        'bad>name',
        'bad|name',
        '.',
        '..',
      ];

      for (const name of invalidNames) {
        await expect(
          scaffoldProject(name, 'minimal', { parentDir: projectsDir, configDir })
        ).rejects.toThrow(/invalid project name/i);
      }
    });

    it('rejects unsupported template variants', async () => {
      await expect(
        scaffoldProject('my-app', 'ruby' as unknown as ProjectTemplate, {
          parentDir: projectsDir,
          configDir,
        })
      ).rejects.toThrow(/invalid or unsupported template/i);
    });

    it('rejects duplicate project names with descriptive error message', async () => {
      await scaffoldProject('existing-app', 'minimal', {
        parentDir: projectsDir,
        configDir,
      });

      await expect(
        scaffoldProject('existing-app', 'minimal', {
          parentDir: projectsDir,
          configDir,
        })
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('Template Generation: minimal', () => {
    it('scaffolds a minimal project with AGENTS.md, .gitignore, and README.md', async () => {
      const result = await scaffoldProject('minimal-demo', 'minimal', {
        parentDir: projectsDir,
        configDir,
      });

      expect(result.name).toBe('minimal-demo');
      expect(result.template).toBe('minimal');
      expect(result.path).toBe(path.join(projectsDir, 'minimal-demo'));
      expect(fs.existsSync(result.path)).toBe(true);

      // Verify files
      expect(fs.existsSync(path.join(result.path, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, '.gitignore'))).toBe(true);
      expect(fs.existsSync(path.join(result.path, 'README.md'))).toBe(true);

      const readme = fs.readFileSync(path.join(result.path, 'README.md'), 'utf8');
      expect(readme).toContain('minimal-demo');

      // Verify template detection
      expect(detectTemplateType(result.path)).toBe('minimal');
    });
  });

  describe('Template Generation: typescript', () => {
    it('scaffolds a typescript project with package.json, tsconfig.json, src/index.ts, and agent guardrails', async () => {
      const result = await scaffoldProject('ts-service', 'typescript', {
        parentDir: projectsDir,
        configDir,
      });

      expect(result.name).toBe('ts-service');
      expect(result.template).toBe('typescript');

      const pkgPath = path.join(result.path, 'package.json');
      const tsconfigPath = path.join(result.path, 'tsconfig.json');
      const srcIndexPath = path.join(result.path, 'src', 'index.ts');

      expect(fs.existsSync(pkgPath)).toBe(true);
      expect(fs.existsSync(tsconfigPath)).toBe(true);
      expect(fs.existsSync(srcIndexPath)).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      expect(pkg.name).toBe('ts-service');

      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
      expect(tsconfig.compilerOptions).toBeDefined();

      const srcCode = fs.readFileSync(srcIndexPath, 'utf8');
      expect(srcCode.length).toBeGreaterThan(0);

      // Verify template detection
      expect(detectTemplateType(result.path)).toBe('typescript');
    });
  });

  describe('Template Generation: python', () => {
    it('scaffolds a python project with pyproject.toml, main.py, requirements.txt, and agent guardrails', async () => {
      const result = await scaffoldProject('py-analyzer', 'python', {
        parentDir: projectsDir,
        configDir,
      });

      expect(result.name).toBe('py-analyzer');
      expect(result.template).toBe('python');

      const pyprojectPath = path.join(result.path, 'pyproject.toml');
      const mainPyPath = path.join(result.path, 'main.py');
      const reqPath = path.join(result.path, 'requirements.txt');

      expect(fs.existsSync(pyprojectPath)).toBe(true);
      expect(fs.existsSync(mainPyPath)).toBe(true);
      expect(fs.existsSync(reqPath)).toBe(true);

      const pyproject = fs.readFileSync(pyprojectPath, 'utf8');
      expect(pyproject).toContain('py-analyzer');

      const mainPy = fs.readFileSync(mainPyPath, 'utf8');
      expect(mainPy).toContain('def main()');

      // Verify template detection
      expect(detectTemplateType(result.path)).toBe('python');
    });
  });

  describe('Template Generation: web', () => {
    it('scaffolds a web starter project with index.html, style.css, main.js, and agent guardrails', async () => {
      const result = await scaffoldProject('web-portal', 'web', {
        parentDir: projectsDir,
        configDir,
      });

      expect(result.name).toBe('web-portal');
      expect(result.template).toBe('web');

      const htmlPath = path.join(result.path, 'index.html');
      const cssPath = path.join(result.path, 'style.css');
      const jsPath = path.join(result.path, 'main.js');

      expect(fs.existsSync(htmlPath)).toBe(true);
      expect(fs.existsSync(cssPath)).toBe(true);
      expect(fs.existsSync(jsPath)).toBe(true);

      const html = fs.readFileSync(htmlPath, 'utf8');
      expect(html).toContain('web-portal');

      // Verify template detection
      expect(detectTemplateType(result.path)).toBe('web');
    });
  });

  describe('Git Repository Initialization & Snapshot Commit', () => {
    it('initializes local Git, stages all files, and creates initial milestone commit', async () => {
      const result = await scaffoldProject('git-test-app', 'typescript', {
        parentDir: projectsDir,
        configDir,
      });

      expect(result.commitHash).toBeDefined();
      expect(result.commitHash.length).toBeGreaterThan(0);

      const git = simpleGit(result.path);
      const isRepo = await git.checkIsRepo();
      expect(isRepo).toBe(true);

      const status = await git.status();
      expect(status.isClean()).toBe(true);
      expect(status.files).toHaveLength(0);

      const log = await git.log();
      expect(log.total).toBe(1);
      expect(log.latest?.message).toBe(
        'checkpoint: Initial commit with agent guardrails & gitignore'
      );
    });
  });

  describe('Ignore Hygiene & Secret Shielding', () => {
    it('generates universal secret-shielding .gitignore that blocks .env, secrets, keys, and agent logs', async () => {
      const result = await scaffoldProject('secret-safe-app', 'typescript', {
        parentDir: projectsDir,
        configDir,
      });

      const gitignore = fs.readFileSync(path.join(result.path, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.env');
      expect(gitignore).toContain('node_modules/');

      const git = simpleGit(result.path);
      const ignoredFiles = [
        '.env',
        '.env.local',
        'secret.key',
        'cert.pem',
        'auth.token',
        'node_modules/foo.js',
        'npm-debug.log',
        '.system_generated/trace.jsonl',
      ];

      const rawCheckResults = await git.checkIgnore(ignoredFiles);
      const checkResults = rawCheckResults.map((p) => p.replace(/\\/g, '/'));
      expect(checkResults).toEqual(expect.arrayContaining(ignoredFiles));
    });
  });

  describe('Agent Guardrails Injection & Custom Templates', () => {
    it('injects AGENTS.md with TDD guardrails and checkpoint milestone conventions', async () => {
      const result = await scaffoldProject('agent-rules-app', 'minimal', {
        parentDir: projectsDir,
        configDir,
      });

      const agentsContent = fs.readFileSync(path.join(result.path, 'AGENTS.md'), 'utf8');
      expect(agentsContent).toContain('AGENTS.md');
      expect(agentsContent).toContain('checkpoint:');
    });

    it('uses custom user AGENTS.md template when present in configDir', async () => {
      const customTemplatesDir = path.join(configDir, 'templates');
      fs.writeFileSync(
        path.join(customTemplatesDir, 'AGENTS.md'),
        '# Custom Organization AGENTS.md\n\n- Custom Rule 1\n- checkpoint: format\n',
        'utf8'
      );

      const result = await scaffoldProject('custom-agent-app', 'minimal', {
        parentDir: projectsDir,
        configDir,
      });

      const agentsContent = fs.readFileSync(path.join(result.path, 'AGENTS.md'), 'utf8');
      expect(agentsContent).toContain('Custom Organization AGENTS.md');
      expect(agentsContent).toContain('Custom Rule 1');
    });
  });
});
