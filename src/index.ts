import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config/index.js';
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
  SUPPORTED_TEMPLATES,
  type ProjectTemplate,
} from './engine/index.js';

export * from './config/index.js';
export * from './ipc/index.js';
export * from './engine/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('proj')
    .description('TypeScript CLI for Developer Workspace & Local Git Project Management')
    .version('0.1.0');

  program
    .command('new <name>')
    .alias('create')
    .description('Scaffold a new project repository with agent guardrails and Git snapshot')
    .option(
      '-t, --template <template>',
      `Starter template (${SUPPORTED_TEMPLATES.join(', ')})`,
      'minimal'
    )
    .action(async (name: string, options: { template?: string }) => {
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
    .command('scratch <name>')
    .alias('throwaway')
    .description('Create a time-boxed throwaway scratchpad project')
    .option(
      '-t, --template <template>',
      `Starter template (${SUPPORTED_TEMPLATES.join(', ')})`,
      'minimal'
    )
    .option('--ttl <days>', 'Time-to-live in days', (val) => parseInt(val, 10))
    .action(async (name: string, options: { template?: string; ttl?: number }) => {
      try {
        const result = await createThrowaway(name, options.ttl, options.template);
        process.stdout.write(
          `Successfully created throwaway scratchpad "${result.name}" at ${result.path} (expires: ${result.expiresAt})\n`
        );
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

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
    .action(async (target?: string) => {
      try {
        const result = await rollbackCheckpoint(process.cwd(), target);
        process.stdout.write(formatRollbackSummary(result) + '\n');
      } catch (err: any) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  program.action(() => {
    program.outputHelp();
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
