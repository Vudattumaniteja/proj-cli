import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import { createProgram } from '../src/index.js';
import { updateConfig } from '../src/config/index.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
  execaSync: vi.fn(),
}));

describe('CLI Project Lifecycle Commands (delete & publish)', () => {
  let tempDir: string;
  let projectsDir: string;
  let throwawaysDir: string;
  const originalEnvConfigDir = process.env.PROJ_CONFIG_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-lifecycle-'));
    process.env.PROJ_CONFIG_DIR = tempDir;
    projectsDir = path.join(tempDir, 'projects');
    throwawaysDir = path.join(projectsDir, 'throwaways');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(throwawaysDir, { recursive: true });

    updateConfig({
      projectsRoot: projectsDir,
      throwawaysRoot: throwawaysDir,
      desktopJunctionPath: path.join(tempDir, 'Desktop', 'Projects'),
    });

    vi.clearAllMocks();
    vi.mocked(execa).mockImplementation((async (
      _file: string,
      args?: readonly string[],
      opts?: { cwd?: string }
    ) => {
      const repoName = args?.[2] || 'test-repo';
      const cwd = opts?.cwd;
      if (cwd) {
        try {
          const git = simpleGit(cwd);
          await git.addRemote('origin', `https://github.com/testuser/${repoName}.git`);
        } catch {
          // ignore
        }
      }
      return {
        stdout: `https://github.com/testuser/${repoName}\n`,
        stderr: '',
        exitCode: 0,
      } as unknown as ReturnType<typeof execa>;
    }) as unknown as typeof execa);
  });

  afterEach(() => {
    if (originalEnvConfigDir !== undefined) {
      process.env.PROJ_CONFIG_DIR = originalEnvConfigDir;
    } else {
      delete process.env.PROJ_CONFIG_DIR;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Commander Registration & Help Text', () => {
    it('documents delete command, alias rm, and flags in help text', () => {
      const program = createProgram();
      program.exitOverride();

      let mainHelp = '';
      program.configureOutput({
        writeOut: (str) => {
          mainHelp += str;
        },
      });

      expect(() => {
        program.parse(['node', 'proj', '--help']);
      }).toThrow();

      expect(mainHelp).toMatch(/delete\|rm/);

      const deleteProgram = createProgram();
      deleteProgram.exitOverride();
      let deleteHelp = '';
      deleteProgram.configureOutput({
        writeOut: (str) => {
          deleteHelp += str;
        },
      });

      expect(() => {
        deleteProgram.parse(['node', 'proj', 'delete', '--help']);
      }).toThrow();

      expect(deleteHelp).toContain('--cloud');
      expect(deleteHelp).toContain('--force');
    });

    it('documents publish command in help text', () => {
      const program = createProgram();
      program.exitOverride();

      let mainHelp = '';
      program.configureOutput({
        writeOut: (str) => {
          mainHelp += str;
        },
      });

      expect(() => {
        program.parse(['node', 'proj', '--help']);
      }).toThrow();

      expect(mainHelp).toMatch(/publish \[name\]/);

      const publishProgram = createProgram();
      publishProgram.exitOverride();
      let publishHelp = '';
      publishProgram.configureOutput({
        writeOut: (str) => {
          publishHelp += str;
        },
      });

      expect(() => {
        publishProgram.parse(['node', 'proj', 'publish', '--help']);
      }).toThrow();

      expect(publishHelp).toContain('publish');
    });
  });

  describe('proj delete <name> local deletion', () => {
    it('deletes target workspace project locally', async () => {
      const projectDir = path.join(projectsDir, 'demo-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');

      expect(fs.existsSync(projectDir)).toBe(true);

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'delete', 'demo-app']);
        expect(output).toContain('Successfully deleted project "demo-app"');
        expect(fs.existsSync(projectDir)).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('supports alias rm to delete project locally', async () => {
      const projectDir = path.join(projectsDir, 'demo-rm-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');

      expect(fs.existsSync(projectDir)).toBe(true);

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'rm', 'demo-rm-app']);
        expect(output).toContain('Successfully deleted project "demo-rm-app"');
        expect(fs.existsSync(projectDir)).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('exits with code 1 and writes error to stderr if project does not exist', async () => {
      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'delete', 'missing-app']);
        expect(errOutput).toContain('Cannot locate project "missing-app"');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });

    it('exits with code 1 and writes descriptive error to stderr if repository is dirty and --force is omitted', async () => {
      const projectDir = path.join(projectsDir, 'dirty-app');
      fs.mkdirSync(projectDir, { recursive: true });
      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-user', false, 'local');
      await git.addConfig('user.email', 'test@example.com', false, 'local');
      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Initial');
      await git.add('.');
      await git.commit('initial commit');

      // Introduce dirty uncommitted change
      fs.writeFileSync(path.join(projectDir, 'dirty.txt'), 'uncommitted content');

      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'delete', 'dirty-app']);
        expect(errOutput).toContain('uncommitted change');
        expect(errOutput).toContain('--force');
        expect(process.exitCode).toBe(1);
        expect(fs.existsSync(projectDir)).toBe(true);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });

    it('bypasses dirty check and deletes project when --force flag is passed', async () => {
      const projectDir = path.join(projectsDir, 'force-dirty-app');
      fs.mkdirSync(projectDir, { recursive: true });
      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-user', false, 'local');
      await git.addConfig('user.email', 'test@example.com', false, 'local');
      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Initial');
      await git.add('.');
      await git.commit('initial commit');

      // Introduce dirty uncommitted change
      fs.writeFileSync(path.join(projectDir, 'dirty.txt'), 'uncommitted content');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'delete', 'force-dirty-app', '--force']);
        expect(output).toContain('Successfully deleted project "force-dirty-app"');
        expect(fs.existsSync(projectDir)).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('deletes remote GitHub repository in addition to local deletion when --cloud is passed', async () => {
      const projectDir = path.join(projectsDir, 'cloud-app');
      fs.mkdirSync(projectDir, { recursive: true });
      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-user', false, 'local');
      await git.addConfig('user.email', 'test@example.com', false, 'local');
      await git.addRemote('origin', 'https://github.com/myorg/cloud-app.git');
      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Initial');
      await git.add('.');
      await git.commit('initial commit');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'delete', 'cloud-app', '--cloud']);
        expect(execa).toHaveBeenCalledWith(
          'gh',
          ['repo', 'delete', 'myorg/cloud-app', '--yes'],
          expect.objectContaining({ cwd: expect.any(String) })
        );
        expect(output).toContain('Successfully deleted project "cloud-app"');
        expect(output).toMatch(/GitHub/i);
        expect(fs.existsSync(projectDir)).toBe(false);
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  describe('proj publish [name] command', () => {
    it('publishes target project by name to a private GitHub repository', async () => {
      const projectDir = path.join(projectsDir, 'publish-target-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("hello");');

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'publish', 'publish-target-app']);
        expect(execa).toHaveBeenCalledWith(
          'gh',
          ['repo', 'create', 'publish-target-app', '--private', '--source', '.', '--remote', 'origin', '--push'],
          expect.objectContaining({ cwd: projectDir })
        );
        expect(output).toContain('Successfully published project "publish-target-app" to GitHub');
        expect(output).toContain('https://github.com/testuser/publish-target-app');
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it('publishes current working directory when name argument is omitted', async () => {
      const projectDir = path.join(projectsDir, 'current-cwd-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("cwd app");');

      const prevCwd = process.cwd();
      process.chdir(projectDir);

      const program = createProgram();
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        output += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'publish']);
        expect(execa).toHaveBeenCalledWith(
          'gh',
          ['repo', 'create', 'current-cwd-app', '--private', '--source', '.', '--remote', 'origin', '--push'],
          expect.objectContaining({ cwd: projectDir })
        );
        expect(output).toContain('Successfully published project "current-cwd-app" to GitHub');
        expect(output).toContain('https://github.com/testuser/current-cwd-app');
      } finally {
        process.chdir(prevCwd);
        process.stdout.write = originalWrite;
      }
    });

    it('exits with code 1 and writes error to stderr when publish target cannot be located', async () => {
      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'publish', 'missing-pub-app']);
        expect(errOutput).toContain('Cannot locate project "missing-pub-app"');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });

    it('exits with code 1 and writes error to stderr if remote origin already configured', async () => {
      const projectDir = path.join(projectsDir, 'already-published-app');
      fs.mkdirSync(projectDir, { recursive: true });
      const git = simpleGit(projectDir);
      await git.init();
      await git.addConfig('user.name', 'test-user', false, 'local');
      await git.addConfig('user.email', 'test@example.com', false, 'local');
      await git.addRemote('origin', 'https://github.com/someone/already-published-app.git');
      fs.writeFileSync(path.join(projectDir, 'README.md'), '# Existing');
      await git.add('.');
      await git.commit('initial commit');

      const program = createProgram();
      let errOutput = '';
      const originalErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk.toString();
        return true;
      }) as any;

      try {
        await program.parseAsync(['node', 'proj', 'publish', 'already-published-app']);
        expect(errOutput).toContain('remote "origin" is already configured');
        expect(process.exitCode).toBe(1);
      } finally {
        process.stderr.write = originalErr;
        process.exitCode = 0;
      }
    });
  });
});
