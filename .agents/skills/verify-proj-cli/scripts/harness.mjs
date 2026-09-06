#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const DIST_INDEX = path.join(REPO_ROOT, 'dist', 'index.js');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts', 'verify-proj-cli');

/**
 * Ensures build output exists.
 */
function ensureBuild() {
  if (!fs.existsSync(DIST_INDEX)) {
    process.stdout.write('Building proj-cli...\n');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const buildRes = spawnSync(npmCmd, ['run', 'build'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: true,
    });
    if (buildRes.status !== 0) {
      throw new Error(`Build failed with exit code ${buildRes.status}`);
    }
  }
}

/**
 * Creates an isolated sandbox environment in os.tmpdir().
 */
function createSandbox(name = 'verify') {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), `proj-${name}-`));
  const configDir = path.join(tmpBase, '.proj');
  const projectsRoot = path.join(tmpBase, 'projects');
  const throwawaysRoot = path.join(projectsRoot, 'throwaways');
  const desktopJunction = path.join(tmpBase, 'Desktop', 'Projects');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(throwawaysRoot, { recursive: true });
  fs.mkdirSync(path.dirname(desktopJunction), { recursive: true });

  const config = {
    projectsRoot,
    throwawaysRoot,
    desktopJunctionPath: desktopJunction,
    defaultTtlDays: 3,
  };

  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
    'utf8'
  );

  return {
    tmpBase,
    configDir,
    projectsRoot,
    throwawaysRoot,
    desktopJunction,
    cleanup() {
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch {
        // Retry once on Windows file locking
        try {
          fs.rmSync(tmpBase, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Runs proj-cli inside a sandbox.
 */
function runProj(args, options = {}) {
  ensureBuild();
  const env = {
    ...process.env,
    PROJ_CONFIG_DIR: options.configDir || process.env.PROJ_CONFIG_DIR,
    GIT_AUTHOR_NAME: 'Proj Verifier',
    GIT_AUTHOR_EMAIL: 'verify@example.com',
    GIT_COMMITTER_NAME: 'Proj Verifier',
    GIT_COMMITTER_EMAIL: 'verify@example.com',
    ...options.env,
  };

  const result = spawnSync(process.execPath, [DIST_INDEX, ...args], {
    cwd: options.cwd || REPO_ROOT,
    env,
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    args,
  };
}

/**
 * Doctor check.
 */
function runDoctor() {
  ensureBuild();
  const checks = [];

  // 1. Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    name: 'Node.js runtime >= 20',
    passed: nodeMajor >= 20,
    details: `v${process.versions.node}`,
  });

  // 2. Build artifact
  const distExists = fs.existsSync(DIST_INDEX);
  checks.push({
    name: 'Build artifact dist/index.js exists',
    passed: distExists,
    details: distExists ? `${DIST_INDEX} (${fs.statSync(DIST_INDEX).size} bytes)` : 'Missing',
  });

  // 3. Git availability
  let gitVersion = '';
  try {
    gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
    checks.push({
      name: 'Git command line tool available',
      passed: true,
      details: gitVersion,
    });
  } catch (err) {
    checks.push({
      name: 'Git command line tool available',
      passed: false,
      details: err.message,
    });
  }

  // 4. Sandbox isolation test
  const sandbox = createSandbox('doc-check');
  try {
    const res = runProj(['doctor', '--json'], { configDir: sandbox.configDir });
    const parsed = JSON.parse(res.stdout);
    checks.push({
      name: 'Isolated sandbox execution and doctor JSON response',
      passed: res.status === 0 && parsed && Array.isArray(parsed.checks),
      details: `Exit code ${res.status}, ${parsed.checks ? parsed.checks.length : 0} checks reported`,
    });
  } catch (err) {
    checks.push({
      name: 'Isolated sandbox execution and doctor JSON response',
      passed: false,
      details: err.message,
    });
  } finally {
    sandbox.cleanup();
  }

  const allPassed = checks.every((c) => c.passed);
  process.stdout.write('\n--- proj-cli Verification Doctor ---\n');
  for (const c of checks) {
    process.stdout.write(`[${c.passed ? 'PASS' : 'FAIL'}] ${c.name} (${c.details})\n`);
  }
  process.stdout.write(`Overall: ${allPassed ? 'HEALTHY' : 'UNHEALTHY'}\n\n`);

  return allPassed ? 0 : 1;
}

/**
 * Saves evidence artifact.
 */
function saveEvidence(feature, filename, content) {
  const dir = path.join(ARTIFACTS_DIR, feature);
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

/**
 * Verifies Feature 1: Scaffolding and Groups.
 */
function verifyScaffolding() {
  const sandbox = createSandbox('feat-scaffold');
  const evidence = [];
  try {
    // 1. Scaffold standalone project
    const newRes = runProj(['new', 'alpha-web', '-t', 'minimal'], {
      configDir: sandbox.configDir,
    });
    evidence.push(`=== Step 1: proj new alpha-web -t minimal ===\nExit code: ${newRes.status}\nSTDOUT:\n${newRes.stdout}\nSTDERR:\n${newRes.stderr}`);
    if (newRes.status !== 0) throw new Error(`scaffold standalone failed: ${newRes.stderr}`);

    // Verify filesystem state
    const alphaPath = path.join(sandbox.projectsRoot, 'alpha-web');
    if (!fs.existsSync(path.join(alphaPath, '.git'))) throw new Error('alpha-web/.git missing');
    if (!fs.existsSync(path.join(alphaPath, 'AGENTS.md'))) throw new Error('alpha-web/AGENTS.md missing');
    if (!fs.existsSync(path.join(alphaPath, '.gitignore'))) throw new Error('alpha-web/.gitignore missing');

    // 2. Scaffold grouped project
    const groupRes = runProj(['new', 'beta-api', '-g', 'backend', '-t', 'minimal'], {
      configDir: sandbox.configDir,
    });
    evidence.push(`\n=== Step 2: proj new beta-api -g backend ===\nExit code: ${groupRes.status}\nSTDOUT:\n${groupRes.stdout}\nSTDERR:\n${groupRes.stderr}`);
    if (groupRes.status !== 0) throw new Error(`scaffold grouped failed: ${groupRes.stderr}`);

    const betaPath = path.join(sandbox.projectsRoot, 'backend', 'beta-api');
    if (!fs.existsSync(path.join(betaPath, '.git'))) throw new Error('backend/beta-api/.git missing');

    // 3. List projects JSON
    const listRes = runProj(['list', '--json'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 3: proj list --json ===\nExit code: ${listRes.status}\nSTDOUT:\n${listRes.stdout}\nSTDERR:\n${listRes.stderr}`);
    if (listRes.status !== 0) throw new Error(`list --json failed: ${listRes.stderr}`);
    const listData = JSON.parse(listRes.stdout);
    if (!Array.isArray(listData) || listData.length < 2) {
      throw new Error(`Expected at least 2 projects, found ${listData.length}`);
    }

    // 4. Move project
    const moveRes = runProj(['move', 'alpha-web', 'frontend'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 4: proj move alpha-web frontend ===\nExit code: ${moveRes.status}\nSTDOUT:\n${moveRes.stdout}\nSTDERR:\n${moveRes.stderr}`);
    if (moveRes.status !== 0) throw new Error(`move failed: ${moveRes.stderr}`);

    const movedPath = path.join(sandbox.projectsRoot, 'frontend', 'alpha-web');
    if (!fs.existsSync(movedPath)) throw new Error('alpha-web did not move to frontend/alpha-web');

    saveEvidence('scaffold-and-groups', 'transcript.txt', evidence.join('\n'));
    saveEvidence('scaffold-and-groups', 'projects.json', JSON.stringify(listData, null, 2));
    process.stdout.write('Feature "scaffold-and-groups" verified successfully.\n');
    return true;
  } finally {
    sandbox.cleanup();
  }
}

/**
 * Verifies Feature 2: Throwaway Scratchpads.
 */
function verifyThrowaway() {
  const sandbox = createSandbox('feat-throwaway');
  const evidence = [];
  try {
    // 1. Create scratchpad
    const scratchRes = runProj(['scratch', 'spike-test', '--ttl', '2'], {
      configDir: sandbox.configDir,
    });
    evidence.push(`=== Step 1: proj scratch spike-test --ttl 2 ===\nExit code: ${scratchRes.status}\nSTDOUT:\n${scratchRes.stdout}`);
    if (scratchRes.status !== 0) throw new Error(`create scratch failed: ${scratchRes.stderr}`);

    const scratchPath = path.join(sandbox.throwawaysRoot, 'spike-test');
    if (!fs.existsSync(scratchPath)) throw new Error('spike-test directory not found');

    // 2. Extend scratchpad
    const extendRes = runProj(['extend', 'spike-test', '5'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 2: proj extend spike-test 5 ===\nExit code: ${extendRes.status}\nSTDOUT:\n${extendRes.stdout}`);
    if (extendRes.status !== 0) throw new Error(`extend failed: ${extendRes.stderr}`);

    // 3. Graduate scratchpad
    const gradRes = runProj(['graduate', 'spike-test'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 3: proj graduate spike-test ===\nExit code: ${gradRes.status}\nSTDOUT:\n${gradRes.stdout}`);
    if (gradRes.status !== 0) throw new Error(`graduate failed: ${gradRes.stderr}`);

    const graduatedPath = path.join(sandbox.projectsRoot, 'spike-test');
    if (!fs.existsSync(graduatedPath)) throw new Error('graduated project not in projectsRoot');
    if (fs.existsSync(scratchPath)) throw new Error('scratch directory still exists in throwawaysRoot');

    saveEvidence('throwaway-lifecycle', 'transcript.txt', evidence.join('\n'));
    process.stdout.write('Feature "throwaway-lifecycle" verified successfully.\n');
    return true;
  } finally {
    sandbox.cleanup();
  }
}

/**
 * Verifies Feature 3: Git Safety Checkpoints.
 */
function verifyCheckpoints() {
  const sandbox = createSandbox('feat-checkpoints');
  const evidence = [];
  try {
    // Scaffold repo
    runProj(['new', 'git-lab', '-t', 'minimal'], { configDir: sandbox.configDir });
    const repoPath = path.join(sandbox.projectsRoot, 'git-lab');

    // Create a dirty change
    fs.writeFileSync(path.join(repoPath, 'experiment.txt'), 'version 1', 'utf8');

    // 1. Create checkpoint
    const cpRes = runProj(['checkpoint', 'initial experiment'], {
      configDir: sandbox.configDir,
      cwd: repoPath,
    });
    evidence.push(`=== Step 1: proj checkpoint "initial experiment" ===\nExit code: ${cpRes.status}\nSTDOUT:\n${cpRes.stdout}`);
    if (cpRes.status !== 0) throw new Error(`checkpoint failed: ${cpRes.stderr}`);

    // 2. List checkpoints
    const listRes = runProj(['checkpoints', '--json'], {
      configDir: sandbox.configDir,
      cwd: repoPath,
    });
    evidence.push(`\n=== Step 2: proj checkpoints --json ===\nExit code: ${listRes.status}\nSTDOUT:\n${listRes.stdout}`);
    if (listRes.status !== 0) throw new Error(`checkpoints list failed: ${listRes.stderr}`);
    const cpList = JSON.parse(listRes.stdout);
    if (!Array.isArray(cpList) || cpList.length === 0) throw new Error('No checkpoints listed');

    // 3. Modify and Undo
    fs.writeFileSync(path.join(repoPath, 'experiment.txt'), 'broken modification', 'utf8');
    const undoRes = runProj(['undo', 'HEAD'], {
      configDir: sandbox.configDir,
      cwd: repoPath,
    });
    evidence.push(`\n=== Step 3: proj undo HEAD ===\nExit code: ${undoRes.status}\nSTDOUT:\n${undoRes.stdout}`);
    if (undoRes.status !== 0) throw new Error(`undo failed: ${undoRes.stderr}`);

    const recoveredContent = fs.readFileSync(path.join(repoPath, 'experiment.txt'), 'utf8');
    if (recoveredContent !== 'version 1') throw new Error('Undo did not restore checkpoint state');

    saveEvidence('git-safety-checkpoints', 'transcript.txt', evidence.join('\n'));
    saveEvidence('git-safety-checkpoints', 'checkpoints.json', JSON.stringify(cpList, null, 2));
    process.stdout.write('Feature "git-safety-checkpoints" verified successfully.\n');
    return true;
  } finally {
    sandbox.cleanup();
  }
}

/**
 * Verifies Feature 4: Doctor and Self-Healing.
 */
function verifyDoctor() {
  const sandbox = createSandbox('feat-doctor');
  const evidence = [];
  try {
    // Run doctor check
    const docRes = runProj(['doctor', '--json'], { configDir: sandbox.configDir });
    evidence.push(`=== Step 1: proj doctor --json ===\nExit code: ${docRes.status}\nSTDOUT:\n${docRes.stdout}`);
    const report = JSON.parse(docRes.stdout);

    // Run doctor fix
    const fixRes = runProj(['doctor', '--fix'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 2: proj doctor --fix ===\nExit code: ${fixRes.status}\nSTDOUT:\n${fixRes.stdout}`);

    // Run rules view
    const rulesRes = runProj(['rules', 'view'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 3: proj rules view ===\nExit code: ${rulesRes.status}\nSTDOUT:\n${rulesRes.stdout}`);
    if (!rulesRes.stdout.includes('# AGENTS.md')) throw new Error('rules view did not output AGENTS.md');

    saveEvidence('doctor-and-diagnostics', 'transcript.txt', evidence.join('\n'));
    saveEvidence('doctor-and-diagnostics', 'doctor-report.json', JSON.stringify(report, null, 2));
    process.stdout.write('Feature "doctor-and-diagnostics" verified successfully.\n');
    return true;
  } finally {
    sandbox.cleanup();
  }
}

/**
 * Verifies Feature 5: Adoption and Navigation.
 */
function verifyAdoption() {
  const sandbox = createSandbox('feat-adoption');
  const evidence = [];
  try {
    // 1. External folder for adoption
    const extDir = path.join(sandbox.tmpBase, 'external-app');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'index.js'), 'console.log("hello")', 'utf8');

    const adoptRes = runProj(['adopt', extDir, '-n', 'adopted-app'], {
      configDir: sandbox.configDir,
    });
    evidence.push(`=== Step 1: proj adopt ${extDir} -n adopted-app ===\nExit code: ${adoptRes.status}\nSTDOUT:\n${adoptRes.stdout}`);
    if (adoptRes.status !== 0) throw new Error(`adopt failed: ${adoptRes.stderr}`);

    const adoptedPath = path.join(sandbox.projectsRoot, 'adopted-app');
    if (!fs.existsSync(path.join(adoptedPath, '.git'))) throw new Error('adopted project .git missing');

    // 2. Navigation tokens (cd & code)
    const cdRes = runProj(['cd', 'adopted-app'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 2: proj cd adopted-app ===\nExit code: ${cdRes.status}\nSTDOUT:\n${cdRes.stdout}`);
    const ipcPath = path.join(sandbox.configDir, 'ipc.json');
    if (!fs.existsSync(ipcPath)) throw new Error('ipc.json not created');
    const ipcData = JSON.parse(fs.readFileSync(ipcPath, 'utf8'));
    if (ipcData.action !== 'cd') throw new Error(`Expected action cd, got ${ipcData.action}`);

    // 3. Delete project
    const delRes = runProj(['delete', 'adopted-app', '-f'], { configDir: sandbox.configDir });
    evidence.push(`\n=== Step 3: proj delete adopted-app -f ===\nExit code: ${delRes.status}\nSTDOUT:\n${delRes.stdout}`);
    if (delRes.status !== 0) throw new Error(`delete failed: ${delRes.stderr}`);
    if (fs.existsSync(adoptedPath)) throw new Error('adopted-app directory still exists after delete');

    saveEvidence('adoption-and-navigation', 'transcript.txt', evidence.join('\n'));
    saveEvidence('adoption-and-navigation', 'ipc.json', JSON.stringify(ipcData, null, 2));
    process.stdout.write('Feature "adoption-and-navigation" verified successfully.\n');
    return true;
  } finally {
    sandbox.cleanup();
  }
}

/**
 * Main CLI handler for harness.
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'doctor';

  if (command === 'doctor') {
    process.exitCode = runDoctor();
    return;
  }

  if (command === 'exec') {
    const projArgs = args.slice(1);
    const sandbox = createSandbox('exec');
    try {
      const res = runProj(projArgs, { configDir: sandbox.configDir });
      process.stdout.write(res.stdout);
      process.stderr.write(res.stderr);
      process.exitCode = res.status;
    } finally {
      sandbox.cleanup();
    }
    return;
  }

  if (command === 'feature') {
    const featureName = args[1] || 'all';
    let ok = true;
    if (featureName === 'scaffold' || featureName === 'all') ok = verifyScaffolding() && ok;
    if (featureName === 'throwaway' || featureName === 'all') ok = verifyThrowaway() && ok;
    if (featureName === 'checkpoints' || featureName === 'all') ok = verifyCheckpoints() && ok;
    if (featureName === 'doctor' || featureName === 'all') ok = verifyDoctor() && ok;
    if (featureName === 'adoption' || featureName === 'all') ok = verifyAdoption() && ok;

    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (command === 'clean') {
    if (fs.existsSync(ARTIFACTS_DIR)) {
      fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
      process.stdout.write(`Cleaned ${ARTIFACTS_DIR}\n`);
    }
    return;
  }

  process.stderr.write(`Unknown harness command: ${command}\n`);
  process.stderr.write('Usage: node harness.mjs [doctor|exec -- <args>|feature <name>|clean]\n');
  process.exitCode = 1;
}

main();
