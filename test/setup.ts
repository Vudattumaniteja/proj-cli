import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll } from 'vitest';

process.env.NODE_ENV = 'test';

// Global test sandbox directory to isolate tests from host environment
const globalTestSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-global-sandbox-'));

if (!process.env.PROJ_CONFIG_DIR) {
  process.env.PROJ_CONFIG_DIR = globalTestSandbox;
}

afterAll(() => {
  try {
    if (fs.existsSync(globalTestSandbox)) {
      fs.rmSync(globalTestSandbox, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup error
  }
});
