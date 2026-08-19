import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

export * from './config/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('proj')
    .description('TypeScript CLI for Developer Workspace & Local Git Project Management')
    .version('0.1.0');

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
    return process.argv[1] === scriptPath || process.argv[1].endsWith('dist/index.js') || process.argv[1].endsWith('proj');
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  run(process.argv);
}
