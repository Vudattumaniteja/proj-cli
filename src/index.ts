import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config/index.js';
import {
  listProjects,
  formatProjectsTable,
  formatProjectsJson,
  scaffoldProject,
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
