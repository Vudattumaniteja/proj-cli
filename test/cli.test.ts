import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/index.js';

describe('proj CLI basic interface', () => {
  it('configures program name, version, and description correctly', () => {
    const program = createProgram();
    expect(program.name()).toBe('proj');
    expect(program.version()).toBe('0.1.0');
    expect(program.description()).toContain('TypeScript CLI for Developer Workspace & Local Git Project Management');
  });

  it('outputs version string when --version flag is passed', () => {
    const program = createProgram();
    program.exitOverride();

    let output = '';
    program.configureOutput({
      writeOut: (str) => {
        output += str;
      },
    });

    expect(() => {
      program.parse(['node', 'proj', '--version']);
    }).toThrow();

    expect(output.trim()).toBe('0.1.0');
  });

  it('outputs help text when --help flag is passed', () => {
    const program = createProgram();
    program.exitOverride();

    let output = '';
    program.configureOutput({
      writeOut: (str) => {
        output += str;
      },
    });

    expect(() => {
      program.parse(['node', 'proj', '--help']);
    }).toThrow();

    expect(output).toContain('Usage: proj [options]');
    expect(output).toContain('TypeScript CLI for Developer Workspace & Local Git Project Management');
  });
});
