import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getConfig,
  ensureConfigDirs,
  getTemplatesDir,
  DEFAULT_AGENTS_TEMPLATE_NAME,
} from './config/index.js';
import { emitIpcToken } from './ipc/index.js';
import {
  listProjects,
  formatProjectsTable,
  formatProjectsJson,
  scaffoldProject,
  createThrowaway,
  createConversation,
  pruneExpiredSilently,
  graduateThrowaway,
  extendThrowaway,
  deleteThrowaway,
  checkExpiredThrowaways,
  createCheckpoint,
  listCheckpoints,
  rollbackCheckpoint,
  formatCheckpointsTable,
  formatRollbackSummary,
  runDoctor,
  fixDoctorIssues,
  formatDoctorReport,
  formatDoctorFixReport,
  adoptProject,
  deleteProject,
  publishProject,
  moveProject,
  resolveProject,
  SUPPORTED_TEMPLATES,
  type ProjectTemplate,
} from './engine/index.js';
import {
  launchInteractiveDashboard,
  interactiveNewProject,
  interactiveThrowaway,
  interactiveRollback,
  interactiveViewProjects,
  interactiveRules,
  interactiveDoctor,
  interactiveAdopt,
} from './tui/index.js';

export * from './config/index.js';
export * from './ipc/index.js';
export * from './engine/index.js';
export * from './tui/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('proj')
    .description('TypeScript CLI for Developer Workspace & Local Git Project Management')
    .version('0.1.0')
    .option('-i, --interactive', 'Launch interactive Clack TUI dashboard');

  program.hook('preAction', (_thisCommand, actionCommand) => {
    if (actionCommand.name() === 'expired' || actionCommand.name() === 'prune-expired') {
      return;
    }
    pruneExpiredSilently();
  });

  program
    .command('init')
    .description('Initialize workspace directories, config, PowerShell IPC bridge, and Desktop Junction')
    .action(async () => {
      try {
        const fixReport = await fixDoctorIssues();
        process.stdout.write(formatDoctorFixReport(fixReport) + '\n');
        if (fixReport.fixedReport.errorCount > 0) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('new [name]')
    .alias('create')
    .description('Scaffold a new project repository with agent guardrails and Git snapshot')
    .option(
      '-t, --template <template>',
      `Starter template (${SUPPORTED_TEMPLATES.join(', ')})`,
      'minimal'
    )
    .option('-g, --group <group>', 'Target project group')
    .option('-i, --interactive', 'Run interactive template wizard')
    .action(
      async (
        name?: string,
        options: { template?: string; group?: string; interactive?: boolean } = {}
      ) => {
        if (!name || options.interactive) {
          if (process.stdin.isTTY || options.interactive) {
            await interactiveNewProject({ initialName: name });
            return;
          }
          process.stderr.write('Error: Missing required argument <name>\n');
          process.exitCode = 1;
          return;
        }

        const template = (options.template || 'minimal') as ProjectTemplate;
        const config = getConfig();
        try {
          const result = await scaffoldProject(name, template, {
            parentDir: config.projectsRoot,
            group: options.group,
          });
          process.stdout.write(`Successfully created project "${result.name}" at ${result.path}\n`);
        } catch (err: unknown) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      }
    );

  program
    .command('list')
    .alias('ls')
    .description('List and inspect workspace projects and scratchpads')
    .option('--json', 'Output project list in JSON format')
    .action(async (options: { json?: boolean }) => {
      const config = getConfig();
      const projects = await listProjects(config.projectsRoot, {
        throwawaysRoot: config.throwawaysRoot,
      });

      if (options.json) {
        process.stdout.write(formatProjectsJson(projects) + '\n');
      } else {
        process.stdout.write(formatProjectsTable(projects) + '\n');
      }
    });

  program
    .command('scratch [name]')
    .alias('throwaway')
    .description('Create a time-boxed throwaway scratchpad project')
    .option(
      '-t, --template <template>',
      `Starter template (${SUPPORTED_TEMPLATES.join(', ')})`,
      'minimal'
    )
    .option('--ttl <days>', 'Time-to-live in days', (val) => parseInt(val, 10))
    .option('-i, --interactive', 'Run interactive scratchpad wizard')
    .action(
      async (
        name?: string,
        options: { template?: string; ttl?: number; interactive?: boolean } = {}
      ) => {
        if (!name || options.interactive) {
          if (process.stdin.isTTY || options.interactive) {
            await interactiveThrowaway({ initialName: name });
            return;
          }
          process.stderr.write('Error: Missing required argument <name>\n');
          process.exitCode = 1;
          return;
        }

        try {
          const result = await createThrowaway(name, options.ttl, options.template);
          process.stdout.write(
            `Successfully created throwaway scratchpad "${result.name}" at ${result.path} (expires: ${result.expiresAt})\n`
          );
        } catch (err: unknown) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      }
    );

  program
    .command('conversation [name]')
    .alias('conv')
    .alias('chat')
    .description('Create a time-boxed 1-day conversation scratchpad and launch agy')
    .option('--no-launch', 'Skip launching agy, just create scratchpad and cd')
    .option(
      '-t, --template <template>',
      `Starter template (${SUPPORTED_TEMPLATES.join(', ')})`,
      'minimal'
    )
    .option('--ttl <days>', 'Time-to-live in days', (val) => parseInt(val, 10))
    .action(
      async (
        name?: string,
        options: { launch?: boolean; template?: string; ttl?: number } = {}
      ) => {
        try {
          const result = await createConversation(name, {
            ttl: options.ttl,
            template: options.template,
          });
          emitIpcToken('cd', result.path);
          process.stdout.write(
            `Successfully created conversation scratchpad "${result.name}" at ${result.path} (expires: ${result.expiresAt})\n`
          );
          if (options.launch !== false && !(options as any).noLaunch) {
            if (process.stdout.isTTY) {
              console.clear();
            }
            childProcess.spawnSync('agy', [], {
              stdio: 'inherit',
              cwd: result.path,
              shell: true,
            });
          }
        } catch (err: unknown) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      }
    );

  program
    .command('graduate <name>')
    .description('Graduate a throwaway scratchpad into a permanent Git-tracked project')
    .action(async (name: string) => {
      try {
        const result = await graduateThrowaway(name);
        process.stdout.write(
          `Successfully graduated throwaway "${result.name}" to ${result.path}\n`
        );
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('extend <name> [days]')
    .description('Extend the expiration TTL of an active throwaway scratchpad')
    .action(async (name: string, daysStr?: string) => {
      try {
        const days = daysStr ? parseInt(daysStr, 10) : 3;
        const result = extendThrowaway(name, days);
        process.stdout.write(
          `Successfully extended throwaway "${result.name}" by ${days} days (new expiration: ${result.expiresAt})\n`
        );
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('delete-throwaway <name>')
    .alias('rm-scratch')
    .alias('rm-throwaway')
    .description('Delete a throwaway scratchpad and clean up metadata')
    .action(async (name: string) => {
      try {
        const result = deleteThrowaway(name);
        process.stdout.write(`Successfully deleted throwaway "${result.name}"\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('expired')
    .alias('prune-expired')
    .description('List or batch delete expired throwaway scratchpads')
    .option('-d, --delete', 'Delete all expired throwaway scratchpads')
    .option('--clean', 'Delete all expired throwaway scratchpads')
    .option('--json', 'Output expired list in JSON format')
    .action(async (options: { delete?: boolean; clean?: boolean; json?: boolean }) => {
      try {
        const expired = checkExpiredThrowaways();
        const shouldDelete = Boolean(options.delete || options.clean);
        if (shouldDelete) {
          if (expired.length === 0) {
            process.stdout.write('No expired throwaways found.\n');
            return;
          }
          for (const exp of expired) {
            const result = deleteThrowaway(exp.name);
            process.stdout.write(`Successfully deleted throwaway "${result.name}"\n`);
          }
          return;
        }

        if (options.json) {
          process.stdout.write(JSON.stringify(expired, null, 2) + '\n');
        } else if (expired.length === 0) {
          process.stdout.write('No expired throwaways found.\n');
        } else {
          process.stdout.write(`Found ${expired.length} expired throwaway(s):\n`);
          for (const exp of expired) {
            process.stdout.write(`- ${exp.name} (expired at ${exp.expiresAt}) -> ${exp.path}\n`);
          }
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('checkpoint [message]')
    .alias('save')
    .description('Create a local Git save-game milestone checkpoint')
    .action(async (message?: string) => {
      try {
        const msg = message && message.trim() ? message.trim() : 'manual checkpoint';
        const result = await createCheckpoint(process.cwd(), msg);
        process.stdout.write(
          `Successfully created checkpoint ${result.shortHash} ("${result.message}")\n`
        );
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('checkpoints')
    .alias('history')
    .description('List recent milestone checkpoints in current repository')
    .option(
      '-n, --limit <number>',
      'Maximum number of checkpoints to retrieve',
      (val) => parseInt(val, 10)
    )
    .option('--json', 'Output checkpoints list in JSON format')
    .action(async (options: { limit?: number; json?: boolean }) => {
      try {
        const checkpoints = await listCheckpoints(process.cwd(), options.limit);
        if (options.json) {
          process.stdout.write(JSON.stringify(checkpoints, null, 2) + '\n');
        } else {
          process.stdout.write(formatCheckpointsTable(checkpoints) + '\n');
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('undo [target]')
    .alias('rollback')
    .description('Safely rollback to previous checkpoint with automated safety stash')
    .option('-i, --interactive', 'Run interactive rollback selector')
    .action(async (target?: string, options: { interactive?: boolean } = {}) => {
      try {
        if (
          options.interactive ||
          (!target && process.stdin.isTTY && process.env.NODE_ENV !== 'test')
        ) {
          await interactiveRollback(process.cwd());
          return;
        }

        const result = await rollbackCheckpoint(process.cwd(), target);
        process.stdout.write(formatRollbackSummary(result) + '\n');
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('adopt <folder-path>')
    .description('Safely move an external project folder into canonical workspace with Git tracking')
    .option('-n, --name <name>', 'Custom project name for adopted repository')
    .action(async (folderPath: string, options: { name?: string }) => {
      try {
        const result = await adoptProject(folderPath, { name: options.name });
        process.stdout.write(`Successfully adopted project "${result.name}" at ${result.path}\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('delete <name>')
    .alias('rm')
    .description('Delete target workspace project locally and optionally from GitHub')
    .option('--cloud', 'Delete the associated remote GitHub repository')
    .option('-f, --force', 'Bypass dirty working tree checks')
    .action(async (name: string, options: { cloud?: boolean; force?: boolean } = {}) => {
      try {
        const result = await deleteProject(name, {
          cloud: options.cloud,
          force: options.force,
        });
        if (result.cloudDeleted) {
          process.stdout.write(
            `Successfully deleted project "${result.name}" locally and from GitHub\n`
          );
        } else {
          process.stdout.write(`Successfully deleted project "${result.name}"\n`);
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('publish [name]')
    .description('Publish a workspace project or current directory to a private GitHub repository')
    .action(async (name?: string) => {
      try {
        const target = name && name.trim() ? name.trim() : '.';
        const result = await publishProject(target);
        process.stdout.write(
          `Successfully published project "${result.name}" to GitHub (${result.repoUrl})\n`
        );
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('rules [action]')
    .description('View or edit global master AGENTS.md conventions')
    .action(async (action?: string) => {
      const normalized = action ? action.trim().toLowerCase() : 'view';
      ensureConfigDirs();
      const templatesDir = getTemplatesDir();
      const agentsPath = path.join(templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME);

      if (normalized === 'edit') {
        emitIpcToken('code', agentsPath);
        process.stdout.write(`Opening master AGENTS.md in VS Code at ${agentsPath}\n`);
      } else if (normalized === 'view') {
        try {
          const content = fs.readFileSync(agentsPath, 'utf8');
          process.stdout.write(content + '\n');
        } catch (err: unknown) {
          process.stderr.write(`Error reading master rules: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      } else {
        process.stderr.write(
          `Error: Unknown rules action "${action}". Must be "view" or "edit".\n`
        );
        process.exitCode = 1;
      }
    });

  program
    .command('cd [name]')
    .alias('jump')
    .description('Emit IPC token to navigate shell to target workspace project, group, throwaway, or workspace root')
    .action(async (name?: string) => {
      try {
        const config = getConfig();
        if (!name || !name.trim()) {
          emitIpcToken('cd', config.projectsRoot);
          process.stdout.write(`Jumping to workspace root at ${config.projectsRoot}\n`);
          return;
        }

        const trimmed = name.trim();
        const resolveResult = await resolveProject(trimmed, config.projectsRoot, {
          throwawaysRoot: config.throwawaysRoot,
        });

        if (resolveResult.resolved && resolveResult.targetPath) {
          emitIpcToken('cd', resolveResult.targetPath);
          process.stdout.write(`Jumping to project "${trimmed}" at ${resolveResult.targetPath}\n`);
          return;
        }

        if (resolveResult.isAmbiguous) {
          const matchPaths = resolveResult.ambiguousMatches
            .map((m) => (m.group ? `${m.group}/${m.name} (${m.path})` : `${m.name} (${m.path})`))
            .join(', ');
          process.stderr.write(
            `Error: Ambiguous project name "${trimmed}". Found ${resolveResult.ambiguousMatches.length} matching projects: ${matchPaths}\n`
          );
          process.exitCode = 1;
          return;
        }

        process.stderr.write(`Error: Project "${trimmed}" not found in workspace\n`);
        process.exitCode = 1;
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('code [name]')
    .description('Emit IPC token to open target workspace project, group, or current directory in VS Code')
    .action(async (name?: string) => {
      try {
        if (!name || !name.trim()) {
          const currentDir = process.cwd();
          emitIpcToken('code', currentDir);
          process.stdout.write(`Opening current directory in VS Code at ${currentDir}\n`);
          return;
        }

        const trimmed = name.trim();
        const config = getConfig();
        const resolveResult = await resolveProject(trimmed, config.projectsRoot, {
          throwawaysRoot: config.throwawaysRoot,
        });

        if (resolveResult.resolved && resolveResult.targetPath) {
          emitIpcToken('code', resolveResult.targetPath);
          process.stdout.write(
            `Opening project "${trimmed}" in VS Code at ${resolveResult.targetPath}\n`
          );
          return;
        }

        if (resolveResult.isAmbiguous) {
          const matchPaths = resolveResult.ambiguousMatches
            .map((m) => (m.group ? `${m.group}/${m.name} (${m.path})` : `${m.name} (${m.path})`))
            .join(', ');
          process.stderr.write(
            `Error: Ambiguous project name "${trimmed}". Found ${resolveResult.ambiguousMatches.length} matching projects: ${matchPaths}\n`
          );
          process.exitCode = 1;
          return;
        }

        process.stderr.write(`Error: Project "${trimmed}" not found in workspace\n`);
        process.exitCode = 1;
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('move <project> <target-group>')
    .alias('mv')
    .description('Relocate a project between root workspace and group subfolders')
    .action(async (project: string, targetGroup: string) => {
      try {
        const config = getConfig();
        const result = await moveProject(project, targetGroup, {
          projectsRoot: config.projectsRoot,
          throwawaysRoot: config.throwawaysRoot,
        });

        if (result.group) {
          process.stdout.write(
            `Successfully moved project "${result.name}" to group "${result.group}" (${result.path})\n`
          );
        } else {
          process.stdout.write(
            `Successfully moved project "${result.name}" to root workspace (${result.path})\n`
          );
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('doctor')
    .description('Run system diagnostic checks and self-heal workspace configuration')
    .option('-f, --fix', 'Automatically repair detected issues')
    .option('--json', 'Output diagnostic report in JSON format')
    .action(async (options: { fix?: boolean; json?: boolean }) => {
      try {
        if (options.fix) {
          const fixReport = await fixDoctorIssues();
          if (options.json) {
            process.stdout.write(JSON.stringify(fixReport, null, 2) + '\n');
          } else {
            process.stdout.write(formatDoctorFixReport(fixReport) + '\n');
          }
          if (fixReport.fixedReport.errorCount > 0) {
            process.exitCode = 1;
          }
        } else {
          const report = await runDoctor();
          if (options.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          } else {
            process.stdout.write(formatDoctorReport(report) + '\n');
          }
          if (report.errorCount > 0) {
            process.exitCode = 1;
          }
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });

  program.action(async (options: { interactive?: boolean } = {}) => {
    pruneExpiredSilently();
    if (options.interactive || (process.stdin.isTTY && process.env.NODE_ENV !== 'test')) {
      await launchInteractiveDashboard();
    } else {
      program.outputHelp();
    }
  });

  return program;
}

export function run(argv: string[] = process.argv): void {
  const program = createProgram();
  program.parse(argv);
}

// Auto-run if executed directly as entrypoint
const isDirectExecution = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = fileURLToPath(import.meta.url);
    const normalizedArgv = path.resolve(process.argv[1]);
    const normalizedScript = path.resolve(scriptPath);
    const normalizedArgvSlash = process.argv[1].replace(/\\/g, '/');
    return (
      normalizedArgv === normalizedScript ||
      (fs.existsSync(normalizedArgv) &&
        fs.existsSync(normalizedScript) &&
        fs.realpathSync(normalizedArgv) === fs.realpathSync(normalizedScript)) ||
      normalizedArgvSlash.endsWith('dist/index.js') ||
      normalizedArgvSlash.endsWith('/proj') ||
      normalizedArgvSlash.endsWith('/proj.cmd') ||
      normalizedArgvSlash.endsWith('/proj.ps1') ||
      normalizedArgvSlash.endsWith('bin/proj.js')
    );
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  run(process.argv);
}
