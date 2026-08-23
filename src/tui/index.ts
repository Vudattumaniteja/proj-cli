import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  getConfig,
  ensureConfigDirs,
  getTemplatesDir,
  DEFAULT_AGENTS_TEMPLATE_NAME,
} from '../config/index.js';
import { emitIpcToken, openInEditor } from '../ipc/index.js';
import {
  listProjects,
  scaffoldProject,
  createThrowaway,
  deleteThrowaway,
  extendThrowaway,
  graduateThrowaway,
  checkExpiredThrowaways,
  createCheckpoint,
  listCheckpoints,
  rollbackCheckpoint,
  runDoctor,
  fixDoctorIssues,
  formatDoctorReport,
  formatDoctorFixReport,
  SUPPORTED_TEMPLATES,
  type ProjectTemplate,
} from '../engine/index.js';
import { adoptProject } from '../engine/adopt.js';

export interface TuiOptions {
  configDir?: string;
  cwd?: string;
}

/**
 * Interactive Wizard for scaffolding a new permanent project.
 */
export async function interactiveNewProject(
  options?: TuiOptions & { initialName?: string }
): Promise<void> {
  let name = options?.initialName;
  if (!name) {
    const enteredName = await p.text({
      message: 'Enter project name:',
      placeholder: 'my-awesome-app',
      validate(val) {
        if (!val || val.trim().length === 0) {
          return 'Project name cannot be empty';
        }
        if (/[/\\:*?"<>|]/.test(val.trim())) {
          return 'Project name contains invalid characters';
        }
      },
    });

    if (p.isCancel(enteredName)) {
      p.cancel('Project creation cancelled.');
      return;
    }
    name = enteredName.trim();
  }

  const templateOptions = SUPPORTED_TEMPLATES.map((t) => {
    switch (t) {
      case 'minimal':
        return { value: t, label: 'minimal', hint: 'README.md, .gitignore, and AGENTS.md guardrails' };
      case 'typescript':
        return { value: t, label: 'typescript', hint: 'Node.js, TypeScript config, test runner, and guardrails' };
      case 'python':
        return { value: t, label: 'python', hint: 'pyproject.toml, main.py, requirements.txt, and guardrails' };
      case 'web':
        return { value: t, label: 'web', hint: 'HTML5, CSS3, ES modules, and guardrails' };
    }
  });

  const selectedTemplate = await p.select({
    message: 'Select project template:',
    options: templateOptions,
  });

  if (p.isCancel(selectedTemplate)) {
    p.cancel('Project creation cancelled.');
    return;
  }

  const s = p.spinner();
  s.start(`Scaffolding project "${name}" with template [${selectedTemplate}]...`);

  try {
    const result = await scaffoldProject(name, selectedTemplate as ProjectTemplate, {
      configDir: options?.configDir,
    });
    s.stop(`Successfully scaffolded "${result.name}" with Git snapshot.`);

    p.note(
      `Project Path: ${result.path}\nTemplate: [${result.template}]\nInitial Commit: ${result.commitHash.substring(0, 7)}`,
      'Project Ready'
    );

    const nextAction = await p.select({
      message: 'What would you like to do next?',
      options: [
        { value: 'code', label: '💻 Open in VS Code', hint: 'Emit IPC token to launch editor' },
        { value: 'jump', label: '🚀 Jump to folder (cd)', hint: 'Navigate terminal shell to project' },
        { value: 'done', label: '✔ Done', hint: 'Return to dashboard or shell' },
      ],
    });

    if (!p.isCancel(nextAction)) {
      if (nextAction === 'code') {
        openInEditor(result.path);
        emitIpcToken('code', result.path, { configDir: options?.configDir });
        p.outro(`Opening ${result.name} in VS Code.`);
      } else if (nextAction === 'jump') {
        emitIpcToken('cd', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to jump to ${result.path}.`);
      }
    }
  } catch (err: any) {
    s.stop('Failed to scaffold project.');
    p.log.error(err.message);
  }
}

/**
 * Interactive Wizard for creating a time-boxed throwaway scratchpad.
 */
export async function interactiveThrowaway(
  options?: TuiOptions & { initialName?: string }
): Promise<void> {
  let name = options?.initialName;
  if (!name) {
    const enteredName = await p.text({
      message: 'Enter throwaway scratchpad name:',
      placeholder: 'spike-auth-prototype',
      validate(val) {
        if (!val || val.trim().length === 0) {
          return 'Scratchpad name cannot be empty';
        }
        if (/[/\\:*?"<>|]/.test(val.trim())) {
          return 'Scratchpad name contains invalid characters';
        }
      },
    });

    if (p.isCancel(enteredName)) {
      p.cancel('Throwaway scratchpad creation cancelled.');
      return;
    }
    name = enteredName.trim();
  }

  const ttlChoice = await p.select({
    message: 'Select Time-to-Live (TTL) expiration:',
    options: [
      { value: 1, label: '1 day', hint: 'Quick 24-hour scratchpad' },
      { value: 3, label: '3 days (default)', hint: 'Standard multi-day spike' },
      { value: 7, label: '7 days', hint: '1-week experimental sandbox' },
      { value: 30, label: '30 days', hint: 'Extended sandbox' },
    ],
  });

  if (p.isCancel(ttlChoice)) {
    p.cancel('Throwaway scratchpad creation cancelled.');
    return;
  }

  const selectedTemplate = await p.select({
    message: 'Select starter template:',
    options: [
      { value: 'minimal', label: 'minimal', hint: 'README.md, .gitignore, AGENTS.md' },
      { value: 'typescript', label: 'typescript', hint: 'Node.js, TypeScript config' },
      { value: 'python', label: 'python', hint: 'pyproject.toml, main.py' },
      { value: 'web', label: 'web', hint: 'HTML5, CSS, JS' },
    ],
  });

  if (p.isCancel(selectedTemplate)) {
    p.cancel('Throwaway scratchpad creation cancelled.');
    return;
  }

  const s = p.spinner();
  s.start(`Creating throwaway scratchpad "${name}" (TTL: ${ttlChoice} days)...`);

  try {
    const result = await createThrowaway(name, ttlChoice as number, selectedTemplate as string, {
      configDir: options?.configDir,
    });
    s.stop(`Successfully created throwaway "${result.name}".`);

    p.note(
      `Location: ${result.path}\nTTL: ${result.ttlDays} day(s)\nExpires: ${result.expiresAt}`,
      'Throwaway Scratchpad Created'
    );

    const nextAction = await p.select({
      message: 'Next step:',
      options: [
        { value: 'code', label: '💻 Open in VS Code', hint: 'Emit IPC token to open in editor' },
        { value: 'jump', label: '🚀 Jump to folder (cd)', hint: 'Navigate shell to scratchpad' },
        { value: 'done', label: '✔ Done' },
      ],
    });

    if (!p.isCancel(nextAction)) {
      if (nextAction === 'code') {
        openInEditor(result.path);
        emitIpcToken('code', result.path, { configDir: options?.configDir });
        p.outro(`Opening ${result.name} in VS Code.`);
      } else if (nextAction === 'jump') {
        emitIpcToken('cd', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to jump to ${result.path}.`);
      }
    }
  } catch (err: any) {
    s.stop('Failed to create throwaway scratchpad.');
    p.log.error(err.message);
  }
}

/**
 * Interactive Rollback Selector displaying recent checkpoints in the target repository.
 */
export async function interactiveRollback(
  repoPath: string = process.cwd(),
  options?: TuiOptions
): Promise<void> {
  const s = p.spinner();
  s.start('Inspecting recent milestone checkpoints...');

  let checkpoints: any[] = [];
  try {
    checkpoints = await listCheckpoints(repoPath, 15);
    s.stop(`Found ${checkpoints.length} milestone checkpoint(s).`);
  } catch (err: any) {
    s.stop('Unable to inspect repository checkpoints.');
    p.log.error(err.message);
    return;
  }

  if (checkpoints.length === 0) {
    p.note(
      `No milestone checkpoints found in repository at ${repoPath}.\nCreate a checkpoint with: proj checkpoint "your message"`,
      'No Checkpoints'
    );
    return;
  }

  const cpOptions = checkpoints.map((cp) => ({
    value: cp.hash,
    label: `${pc.cyan(cp.shortHash)} - ${cp.message}`,
    hint: `${pc.dim(cp.relativeTimestamp)} (${cp.authorName || 'agent'})`,
  }));

  cpOptions.push({
    value: '__cancel__',
    label: pc.dim('↩ Cancel rollback'),
    hint: '',
  });

  const selectedCommit = await p.select({
    message: 'Select milestone checkpoint to restore:',
    options: cpOptions,
  });

  if (p.isCancel(selectedCommit) || selectedCommit === '__cancel__') {
    p.cancel('Rollback cancelled.');
    return;
  }

  const rollbackSpinner = p.spinner();
  rollbackSpinner.start('Creating safety stash and restoring target checkpoint...');

  try {
    const result = await rollbackCheckpoint(repoPath, selectedCommit as string);
    rollbackSpinner.stop('Rollback completed successfully.');
    p.note(result.summary, 'Rollback Summary');
  } catch (err: any) {
    rollbackSpinner.stop('Rollback failed.');
    p.log.error(err.message);
  }
}

/**
 * Interactive repository browser and context action menu ('View & Jump to Projects').
 */
export async function interactiveViewProjects(options?: TuiOptions): Promise<'exit' | 'back'> {
  const config = getConfig({ configDir: options?.configDir });
  const s = p.spinner();
  s.start('Scanning workspace repositories & scratchpads...');

  let projects: any[] = [];
  try {
    projects = await listProjects(config.projectsRoot, {
      throwawaysRoot: config.throwawaysRoot,
    });
    s.stop(`Discovered ${projects.length} project(s).`);
  } catch (err: any) {
    s.stop('Failed to scan workspace.');
    p.log.error(err.message);
    return 'back';
  }

  if (projects.length === 0) {
    p.note(
      `No projects found in workspace root: ${config.projectsRoot}\nUse "proj new <name>" to create one!`,
      'Workspace Empty'
    );
    return 'back';
  }

  const projectOptions = projects.map((proj) => {
    const gitStatus = proj.isGit
      ? `${proj.branch || 'HEAD'} ${
          proj.isDirty
            ? pc.yellow(`● (${proj.dirtyCount} dirty)`)
            : pc.green('✔ clean')
        }`
      : pc.dim('non-git');

    const throwawayBadge = proj.isThrowaway
      ? proj.isExpired
        ? pc.red(' [throwaway: EXPIRED]')
        : pc.magenta(' [throwaway]')
      : '';
    const badge = pc.dim(proj.templateBadge);

    return {
      value: proj.name,
      label: `${proj.name} ${badge}${throwawayBadge}`,
      hint: `${gitStatus} • ${proj.path}`,
    };
  });

  projectOptions.push({
    value: '__back__',
    label: pc.dim('↩ Back to Main Dashboard'),
    hint: '',
  });

  const selectedProjName = await p.select({
    message: 'Select a project to inspect or take action:',
    options: projectOptions,
  });

  if (p.isCancel(selectedProjName) || selectedProjName === '__back__') {
    return 'back';
  }

  const targetProject = projects.find((p) => p.name === selectedProjName);
  if (!targetProject) return 'back';

  // Context Actions Menu for selected project
  const actionsList = [
    {
      value: 'jump',
      label: '🚀 Jump (cd)',
      hint: `Navigate shell to ${targetProject.path}`,
    },
    {
      value: 'code',
      label: '💻 Open in VS Code',
      hint: 'Emit IPC token to open in VS Code',
    },
  ];

  if (targetProject.isThrowaway) {
    actionsList.push(
      {
        value: 'graduate',
        label: '🎓 Graduate to Permanent Project',
        hint: 'Move scratchpad to canonical projects root and initialize Git',
      },
      {
        value: 'extend',
        label: '⏳ Extend TTL (+3 days)',
        hint: 'Extend expiration deadline by 3 days',
      },
      {
        value: 'delete',
        label: '🗑️ Delete Throwaway',
        hint: 'Delete scratchpad directory and purge metadata',
      }
    );
  }

  actionsList.push(
    {
      value: 'checkpoint',
      label: '💾 Save Checkpoint',
      hint: 'Create milestone save commit in this repository',
    },
    {
      value: 'rollback',
      label: '⏪ Rollback / Undo',
      hint: 'Restore previous milestone with safety stash',
    },
    {
      value: 'back',
      label: '↩ Back to Project List',
      hint: '',
    }
  );

  const contextAction = await p.select({
    message: `Actions for "${targetProject.name}":`,
    options: actionsList,
  });

  if (p.isCancel(contextAction) || contextAction === 'back') {
    return interactiveViewProjects(options);
  }

  if (contextAction === 'jump') {
    emitIpcToken('cd', targetProject.path, { configDir: options?.configDir });
    p.outro(`Emitted IPC token. Jumping to ${targetProject.name} (${targetProject.path}).`);
    return 'exit';
  }

  if (contextAction === 'code') {
    openInEditor(targetProject.path);
    emitIpcToken('code', targetProject.path, { configDir: options?.configDir });
    p.outro(`Opening ${targetProject.name} in VS Code.`);
    return 'exit';
  }

  if (contextAction === 'graduate') {
    try {
      const result = await graduateThrowaway(targetProject.name, { configDir: options?.configDir });
      p.note(`Graduated throwaway "${result.name}" to ${result.path}`, 'Project Graduated');
    } catch (err: any) {
      p.log.error(err.message);
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'extend') {
    try {
      const result = extendThrowaway(targetProject.name, 3, { configDir: options?.configDir });
      p.note(`Extended throwaway "${result.name}" until ${result.expiresAt}`, 'TTL Extended');
    } catch (err: any) {
      p.log.error(err.message);
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'delete') {
    try {
      const result = deleteThrowaway(targetProject.name, { configDir: options?.configDir });
      p.note(`Deleted throwaway "${result.name}"`, 'Throwaway Deleted');
    } catch (err: any) {
      p.log.error(err.message);
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'checkpoint') {
    const msg = await p.text({
      message: 'Enter checkpoint message:',
      placeholder: 'implemented feature X',
      initialValue: 'manual checkpoint',
      validate(val) {
        if (!val || val.trim().length === 0) return 'Message cannot be empty';
      },
    });

    if (p.isCancel(msg)) {
      p.cancel('Checkpoint cancelled.');
    } else {
      try {
        const cp = await createCheckpoint(targetProject.path, msg);
        p.note(
          `Created checkpoint ${cp.shortHash} ("${cp.message}")\nChanged files: ${cp.filesChanged}`,
          'Checkpoint Saved'
        );
      } catch (err: any) {
        p.log.error(err.message);
      }
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'rollback') {
    await interactiveRollback(targetProject.path, options);
    return interactiveViewProjects(options);
  }

  return 'back';
}

/**
 * Interactive master rules view/edit wizard.
 */
export async function interactiveRules(options?: TuiOptions): Promise<void> {
  ensureConfigDirs(options);
  const templatesDir = getTemplatesDir(options?.configDir);
  const agentsPath = path.join(templatesDir, DEFAULT_AGENTS_TEMPLATE_NAME);

  const action = await p.select({
    message: 'Master AI Agent Rules (AGENTS.md):',
    options: [
      { value: 'view', label: '📜 View Master Rules', hint: `Print contents of ${agentsPath}` },
      { value: 'edit', label: '💻 Edit in VS Code', hint: 'Emit IPC token to open in editor' },
      { value: 'back', label: '↩ Back' },
    ],
  });

  if (p.isCancel(action) || action === 'back') {
    return;
  }

  if (action === 'view') {
    let content = '';
    try {
      content = fs.readFileSync(agentsPath, 'utf8');
    } catch {
      content = 'No master AGENTS.md rules found.';
    }
    p.note(content, 'Master AGENTS.md Rules');
  } else if (action === 'edit') {
    openInEditor(agentsPath);
    emitIpcToken('code', agentsPath, { configDir: options?.configDir });
    p.outro(`Opening master AGENTS.md in VS Code (${agentsPath}).`);
  }
}

/**
 * Interactive System Doctor Diagnostics and Self-Healing.
 */
export async function interactiveDoctor(options?: TuiOptions): Promise<void> {
  const choice = await p.select({
    message: 'System Doctor Diagnostics:',
    options: [
      { value: 'check', label: '🩺 Run Diagnostic Health Checks', hint: 'Verify Git, paths, junctions, and templates' },
      { value: 'fix', label: '🛠️ Run Self-Healing & Auto-Repair (--fix)', hint: 'Automatically fix missing folders, broken junctions, config' },
      { value: 'back', label: '↩ Back' },
    ],
  });

  if (p.isCancel(choice) || choice === 'back') {
    return;
  }

  const s = p.spinner();
  if (choice === 'check') {
    s.start('Running system diagnostics...');
    const report = await runDoctor(options);
    s.stop('Diagnostics complete.');
    p.note(formatDoctorReport(report), 'System Doctor Report');
  } else if (choice === 'fix') {
    s.start('Running system diagnostics and repairing detected issues...');
    const fixReport = await fixDoctorIssues(options);
    s.stop('Diagnostics and self-healing repair complete.');
    p.note(formatDoctorFixReport(fixReport), 'Doctor Self-Healing Report');
  }
}

/**
 * Interactive folder adoption wizard.
 */
export async function interactiveAdopt(options?: TuiOptions): Promise<void> {
  const folderPath = await p.text({
    message: 'Enter folder path to adopt into canonical workspace:',
    placeholder: 'C:\\Users\\User\\Desktop\\legacy-app',
    validate(val) {
      if (!val || val.trim().length === 0) return 'Folder path cannot be empty';
    },
  });

  if (p.isCancel(folderPath)) {
    p.cancel('Adoption cancelled.');
    return;
  }

  const s = p.spinner();
  s.start(`Adopting folder "${folderPath}" into canonical workspace...`);

  try {
    const result = await adoptProject(folderPath, {
      configDir: options?.configDir,
    });
    s.stop(`Successfully adopted "${result.name}".`);

    p.note(
      `Project Name: ${result.name}\nCanonical Path: ${result.path}\nGit Tracking: ${result.isGit ? 'Initialized' : 'Preserved'}`,
      'Project Adopted'
    );

    const nextAction = await p.select({
      message: 'Next step:',
      options: [
        { value: 'code', label: '💻 Open in VS Code', hint: 'Emit IPC token' },
        { value: 'jump', label: '🚀 Jump to folder (cd)', hint: 'Navigate shell' },
        { value: 'done', label: '✔ Done' },
      ],
    });

    if (!p.isCancel(nextAction)) {
      if (nextAction === 'code') {
        openInEditor(result.path);
        emitIpcToken('code', result.path, { configDir: options?.configDir });
        p.outro(`Opening ${result.name} in VS Code.`);
      } else if (nextAction === 'jump') {
        emitIpcToken('cd', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to jump to ${result.path}.`);
      }
    }
  } catch (err: any) {
    s.stop('Failed to adopt folder.');
    p.log.error(err.message);
  }
}

/**
 * Prompts the user to handle any expired throwaway scratchpads (Delete, Extend, Graduate, or Skip).
 */
export async function handleExpiredThrowaways(options?: TuiOptions): Promise<void> {
  const expired = checkExpiredThrowaways({ configDir: options?.configDir });
  if (expired.length === 0) return;

  p.log.warn(
    pc.yellow(`Found ${expired.length} expired throwaway scratchpad${expired.length > 1 ? 's' : ''}.`)
  );

  for (const record of expired) {
    const action = await p.select({
      message: `Expired scratchpad: "${record.name}" (expired on ${record.expiresAt.slice(0, 10)})`,
      options: [
        {
          value: 'delete',
          label: '🗑️ Delete scratchpad',
          hint: 'Purge folder from disk and remove metadata',
        },
        {
          value: 'extend',
          label: '⏳ Extend TTL (+3 days)',
          hint: 'Keep scratchpad active for 3 more days',
        },
        {
          value: 'graduate',
          label: '🎓 Graduate to permanent project',
          hint: 'Move to canonical projects root and initialize Git',
        },
        {
          value: 'skip',
          label: '⏭️ Skip for now',
          hint: 'Decide later',
        },
      ],
    });

    if (p.isCancel(action) || action === 'skip') {
      continue;
    }

    if (action === 'delete') {
      try {
        deleteThrowaway(record.name, { configDir: options?.configDir });
        p.log.success(`Deleted expired scratchpad "${record.name}".`);
      } catch (err: any) {
        p.log.error(`Failed to delete "${record.name}": ${err.message}`);
      }
    } else if (action === 'extend') {
      try {
        const updated = extendThrowaway(record.name, 3, { configDir: options?.configDir });
        p.log.success(`Extended "${record.name}" until ${updated.expiresAt.slice(0, 10)}.`);
      } catch (err: any) {
        p.log.error(`Failed to extend "${record.name}": ${err.message}`);
      }
    } else if (action === 'graduate') {
      try {
        const grad = await graduateThrowaway(record.name, { configDir: options?.configDir });
        p.log.success(`Graduated "${record.name}" to ${grad.path}.`);
      } catch (err: any) {
        p.log.error(`Failed to graduate "${record.name}": ${err.message}`);
      }
    }
  }
}

/**
 * Top-Level Clack TUI Dashboard Runner.
 */
export async function launchInteractiveDashboard(options?: TuiOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black('  PROJ WORKSPACE DASHBOARD  ')));

  await handleExpiredThrowaways(options);

  let running = true;
  while (running) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        {
          value: 'projects',
          label: '📂 View & Jump to Projects',
          hint: 'Browse repositories, jump (cd), open in editor, or manage checkpoints',
        },
        {
          value: 'new',
          label: '✨ Create New Project',
          hint: 'Scaffold permanent project with template & guardrails',
        },
        {
          value: 'scratch',
          label: '⏱️ Throwaway Scratchpad',
          hint: 'Create time-boxed experimental sandbox with TTL',
        },
        {
          value: 'checkpoint',
          label: '💾 Save Checkpoint',
          hint: 'Create instant milestone commit in current repo',
        },
        {
          value: 'undo',
          label: '⏪ Rollback / Undo',
          hint: 'Safe rollback to previous checkpoint with safety stash',
        },
        {
          value: 'adopt',
          label: '📥 Adopt Existing Folder',
          hint: 'Safely move external project into workspace with Git tracking',
        },
        {
          value: 'rules',
          label: '📜 Master Agent Rules (AGENTS.md)',
          hint: 'View or edit master AGENTS.md conventions',
        },
        {
          value: 'doctor',
          label: '🩺 System Doctor',
          hint: 'Run workspace diagnostic health checks and self-heal',
        },
        {
          value: 'exit',
          label: '🚪 Exit',
          hint: 'Close dashboard',
        },
      ],
    });

    if (p.isCancel(action) || action === 'exit') {
      p.outro('Goodbye!');
      running = false;
      break;
    }

    switch (action) {
      case 'projects': {
        const result = await interactiveViewProjects(options);
        if (result === 'exit') {
          running = false;
        }
        break;
      }
      case 'new':
        await interactiveNewProject(options);
        break;
      case 'scratch':
        await interactiveThrowaway(options);
        break;
      case 'checkpoint': {
        const msg = await p.text({
          message: 'Enter checkpoint message:',
          placeholder: 'checkpoint message',
          initialValue: 'manual checkpoint',
          validate(val) {
            if (!val || val.trim().length === 0) return 'Message cannot be empty';
          },
        });
        if (!p.isCancel(msg)) {
          try {
            const cp = await createCheckpoint(options?.cwd || process.cwd(), msg);
            p.note(`Created checkpoint ${cp.shortHash}: "${cp.message}"`, 'Checkpoint Saved');
          } catch (err: any) {
            p.log.error(err.message);
          }
        }
        break;
      }
      case 'undo':
        await interactiveRollback(options?.cwd || process.cwd(), options);
        break;
      case 'adopt':
        await interactiveAdopt(options);
        break;
      case 'rules':
        await interactiveRules(options);
        break;
      case 'doctor':
        await interactiveDoctor(options);
        break;
    }
  }
}
