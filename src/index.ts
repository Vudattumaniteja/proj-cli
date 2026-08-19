import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
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

  program
    .command('new [name]')
    .alias('create')
    .description('Scaffold a new project repository with agent guardrails and Git snapshot')
    .option(
      '-t, --template <template>',
      `Starter template (${SUPPORTED_TEMPLATES.join(', ')})`,
      'minimal'
    )
    .option('-i, --interactive', 'Run interactive template wizard')
    .action(async (name?: string, options: { template?: string; interactive?: boolean } = {}) => {
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
        });
        process.stdout.write(`Successfully created project "${result.name}" at ${result.path}\n`);
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

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
        } catch (err: any) {
          process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('expired')
    .description('List expired throwaway scratchpads')
    .option('--json', 'Output expired list in JSON format')
    .action((options: { json?: boolean }) => {
      try {
        const expired = checkExpiredThrowaways();
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
        } catch (err: any) {
          process.stderr.write(`Error reading master rules: ${err.message}\n`);
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
    .command('code [name]')
    .description('Emit IPC token to open target workspace project or current directory in VS Code')
    .action(async (name?: string) => {
      try {
        if (!name) {
          const currentDir = process.cwd();
          emitIpcToken('code', currentDir);
          process.stdout.write(`Opening current directory in VS Code at ${currentDir}\n`);
          return;
        }

        const config = getConfig();
        const candidate1 = path.join(config.projectsRoot, name);
        const candidate2 = path.join(config.throwawaysRoot, name);
        const candidate3 = path.resolve(name);

        let targetPath: string | null = null;
        if (fs.existsSync(candidate1)) {
          targetPath = candidate1;
        } else if (fs.existsSync(candidate2)) {
          targetPath = candidate2;
        } else if (fs.existsSync(candidate3)) {
          targetPath = candidate3;
        }

        if (!targetPath) {
          process.stderr.write(`Error: Project "${name}" not found in workspace\n`);
          process.exitCode = 1;
          return;
        }

        emitIpcToken('code', targetPath);
        process.stdout.write(`Opening project "${name}" in VS Code at ${targetPath}\n`);
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
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
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  program.action(async (options: { interactive?: boolean } = {}) => {
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
    return (
      process.argv[1] === scriptPath ||
      process.argv[1].endsWith('dist/index.js') ||
      process.argv[1].endsWith('proj')
    );
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  run(process.argv);
}
