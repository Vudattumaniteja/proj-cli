import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { simpleGit } from 'simple-git';
import { execa } from 'execa';
import {
  getConfig,
  ensureConfigDirs,
  getTemplatesDir,
  DEFAULT_AGENTS_TEMPLATE_NAME,
} from '../config/index.js';
import { emitIpcToken } from '../ipc/index.js';
import {
  listProjects,
  scaffoldProject,
  createThrowaway,
  checkExpiredThrowaways,
  extendThrowaway,
  deleteThrowaway,
  graduateThrowaway,
  createCheckpoint,
  listCheckpoints,
  rollbackCheckpoint,
  runDoctor,
  fixDoctorIssues,
  formatDoctorReport,
  formatDoctorFixReport,
  adoptProject,
  publishProject,
  deleteProject,
  SUPPORTED_TEMPLATES,
  type ProjectTemplate,
  type ProjectInfo,
  type CheckpointInfo,
} from '../engine/index.js';

export interface TuiOptions {
  configDir?: string;
  cwd?: string;
  now?: Date | string | number;
}

/**
 * Interactive Wizard for scaffolding a new permanent project.
 */
export async function interactiveNewProject(
  options?: TuiOptions & { initialName?: string }
): Promise<'exit' | void> {
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
        emitIpcToken('code', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to open ${result.name} in VS Code.`);
        return 'exit';
      } else if (nextAction === 'jump') {
        emitIpcToken('cd', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to jump to ${result.path}.`);
        return 'exit';
      }
    }
  } catch (err: unknown) {
    s.stop('Failed to scaffold project.');
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Interactive Wizard for creating a time-boxed throwaway scratchpad.
 */
export async function interactiveThrowaway(
  options?: TuiOptions & { initialName?: string }
): Promise<'exit' | void> {
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
        emitIpcToken('code', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to open ${result.name} in VS Code.`);
        return 'exit';
      } else if (nextAction === 'jump') {
        emitIpcToken('cd', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to jump to ${result.path}.`);
        return 'exit';
      }
    }
  } catch (err: unknown) {
    s.stop('Failed to create throwaway scratchpad.');
    p.log.error(err instanceof Error ? err.message : String(err));
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

  let checkpoints: CheckpointInfo[] = [];
  try {
    checkpoints = await listCheckpoints(repoPath, 15);
    s.stop(`Found ${checkpoints.length} milestone checkpoint(s).`);
  } catch (err: unknown) {
    s.stop('Unable to inspect repository checkpoints.');
    p.log.error(err instanceof Error ? err.message : String(err));
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
  } catch (err: unknown) {
    rollbackSpinner.stop('Rollback failed.');
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Interactive repository browser and context action menu ('View & Jump to Projects').
 */
export async function interactiveViewProjects(options?: TuiOptions): Promise<'exit' | 'back'> {
  const config = getConfig({ configDir: options?.configDir });
  const s = p.spinner();
  s.start('Scanning workspace repositories & scratchpads...');

  let projects: ProjectInfo[] = [];
  try {
    projects = await listProjects(config.projectsRoot, {
      throwawaysRoot: config.throwawaysRoot,
      configDir: options?.configDir,
      now: options?.now,
    });
    s.stop(`Discovered ${projects.length} project(s).`);
  } catch (err: unknown) {
    s.stop('Failed to scan workspace.');
    p.log.error(err instanceof Error ? err.message : String(err));
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

    let throwawayBadge = '';
    if (proj.isThrowaway) {
      throwawayBadge = proj.isExpired
        ? pc.red(' [throwaway: EXPIRED]')
        : pc.magenta(' [throwaway]');
    }
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
  const actionOptions: Array<{ value: string; label: string; hint?: string }> = [
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
  ];

  if (!targetProject.hasRemote) {
    actionOptions.push({
      value: 'publish',
      label: '☁️ Publish to GitHub (Private)',
      hint: 'Create private GitHub repository and push',
    });
  } else {
    actionOptions.push({
      value: 'open-github',
      label: '🌐 Open on GitHub',
      hint: targetProject.githubRepo?.webUrl || targetProject.remoteUrl || 'Open repository on GitHub',
    });
  }

  if (targetProject.isThrowaway) {
    actionOptions.push(
      {
        value: 'graduate',
        label: '🎓 Graduate to Permanent Project',
        hint: 'Promote to permanent project in canonical workspace',
      },
      {
        value: 'extend',
        label: '⏳ Extend TTL (+3 days)',
        hint: 'Extend expiration by 3 days',
      },
      {
        value: 'delete',
        label: '🗑️ Delete Throwaway',
        hint: 'Permanently remove from disk and config',
      }
    );
  } else {
    actionOptions.push({
      value: 'delete',
      label: '🗑️ Delete Project',
      hint: 'Delete project locally or from GitHub',
    });
  }

  actionOptions.push({
    value: 'back',
    label: pc.dim('↩ Back to Project List'),
    hint: '',
  });

  const contextAction = await p.select({
    message: `Actions for "${targetProject.name}":`,
    options: actionOptions,
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
    emitIpcToken('code', targetProject.path, { configDir: options?.configDir });
    p.outro(`Emitted IPC token. Opening ${targetProject.name} in VS Code.`);
    return 'exit';
  }

  if (contextAction === 'open-github') {
    const webUrl = targetProject.githubRepo?.webUrl || targetProject.remoteUrl || '';
    try {
      await execa('gh', ['browse'], { cwd: targetProject.path });
      p.outro(`Opened ${webUrl || targetProject.name} on GitHub.`);
    } catch {
      // Fallback if gh browse is not installed or fails
    }
    if (webUrl) {
      p.note(`Repository URL: ${webUrl}`, 'GitHub Repository');
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'publish') {
    const pubSpinner = p.spinner();
    pubSpinner.start(`Publishing "${targetProject.name}" to private GitHub repository...`);
    try {
      const result = await publishProject(targetProject.name, {
        configDir: options?.configDir,
        projectsRoot: config.projectsRoot,
        throwawaysRoot: config.throwawaysRoot,
      });
      pubSpinner.stop(`Successfully published "${result.name}" to GitHub.`);
      p.note(
        `Repository URL: ${result.repoUrl}\nVisibility: Private\nProject Path: ${result.path}`,
        'Published to GitHub'
      );
    } catch (err: unknown) {
      pubSpinner.stop('Failed to publish project to GitHub.');
      p.log.error(err instanceof Error ? err.message : String(err));
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
      } catch (err: unknown) {
        p.log.error(err instanceof Error ? err.message : String(err));
      }
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'rollback') {
    await interactiveRollback(targetProject.path, options);
    return interactiveViewProjects(options);
  }

  if (contextAction === 'graduate') {
    const gradSpinner = p.spinner();
    gradSpinner.start(`Graduating throwaway "${targetProject.name}" to canonical workspace...`);
    try {
      const grad = await graduateThrowaway(targetProject.name, { configDir: options?.configDir });
      gradSpinner.stop(`Successfully graduated "${grad.name}" to ${grad.path}.`);
      p.note(
        `Project Name: ${grad.name}\nCanonical Path: ${grad.path}\nGit Initialized: ${grad.isGit ? 'Yes' : 'No'}`,
        'Throwaway Graduated'
      );
    } catch (err: unknown) {
      gradSpinner.stop(`Failed to graduate "${targetProject.name}".`);
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'extend') {
    const extSpinner = p.spinner();
    extSpinner.start(`Extending throwaway "${targetProject.name}" (+3 days)...`);
    try {
      const updated = extendThrowaway(targetProject.name, 3, { configDir: options?.configDir });
      extSpinner.stop(`Extended "${updated.name}" (new expiration: ${updated.expiresAt}).`);
      p.note(
        `New Expiration: ${updated.expiresAt}\nTotal TTL: ${updated.ttlDays} day(s)`,
        'Throwaway Extended'
      );
    } catch (err: unknown) {
      extSpinner.stop(`Failed to extend "${targetProject.name}".`);
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    return interactiveViewProjects(options);
  }

  if (contextAction === 'delete') {
    if (targetProject.isThrowaway) {
      const delSpinner = p.spinner();
      delSpinner.start(`Deleting throwaway "${targetProject.name}"...`);
      try {
        deleteThrowaway(targetProject.name, { configDir: options?.configDir });
        delSpinner.stop(`Deleted throwaway "${targetProject.name}".`);
      } catch (err: unknown) {
        delSpinner.stop(`Failed to delete "${targetProject.name}".`);
        p.log.error(err instanceof Error ? err.message : String(err));
      }
      return interactiveViewProjects(options);
    }

    let deleteCloud = false;
    if (targetProject.hasRemote) {
      const deleteScope = await p.select({
        message: `Select deletion scope for "${targetProject.name}":`,
        options: [
          {
            value: 'local',
            label: 'Delete locally only',
            hint: 'Keep remote GitHub repository intact',
          },
          {
            value: 'cloud',
            label: 'Delete GitHub repo in cloud and locally',
            hint: 'Permanently delete remote GitHub repo and local directory',
          },
        ],
      });

      if (p.isCancel(deleteScope)) {
        p.cancel('Project deletion cancelled.');
        return interactiveViewProjects(options);
      }

      deleteCloud = deleteScope === 'cloud';
    }

    const confirmed = await p.confirm({
      message: 'Are you sure you want to delete this project? Press Enter to confirm.',
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Project deletion cancelled.');
      return interactiveViewProjects(options);
    }

    let isDirty = targetProject.isDirty;
    let dirtyCount = targetProject.dirtyCount;
    if (targetProject.isGit) {
      try {
        const git = simpleGit(targetProject.path, { maxConcurrentProcesses: 2 });
        const st = await git.status();
        dirtyCount = st.files.length;
        isDirty = dirtyCount > 0;
      } catch {
        // Fall back to targetProject values
      }
    }

    if (isDirty) {
      p.log.warn(
        pc.yellow(
          `Warning: Working tree has ${dirtyCount} uncommitted change${
            dirtyCount === 1 ? '' : 's'
          }!`
        )
      );

      const confirmDirty = await p.confirm({
        message: `Working tree is dirty (${dirtyCount} uncommitted change${
          dirtyCount === 1 ? '' : 's'
        }). Confirm deletion?`,
        initialValue: false,
      });

      if (p.isCancel(confirmDirty) || !confirmDirty) {
        p.cancel('Project deletion cancelled.');
        return interactiveViewProjects(options);
      }
    }

    const delSpinner = p.spinner();
    delSpinner.start(
      `Deleting project "${targetProject.name}"${deleteCloud ? ' (local & cloud)' : ''}...`
    );

    try {
      const result = await deleteProject(targetProject.path, {
        cloud: deleteCloud,
        force: isDirty,
        configDir: options?.configDir,
        projectsRoot: config.projectsRoot,
        throwawaysRoot: config.throwawaysRoot,
      });

      if (result.cloudDeleted) {
        delSpinner.stop(
          `Successfully deleted project "${result.name}" locally and from GitHub.`
        );
      } else {
        delSpinner.stop(`Successfully deleted project "${result.name}".`);
      }
    } catch (err: unknown) {
      delSpinner.stop('Failed to delete project.');
      p.log.error(err instanceof Error ? err.message : String(err));
    }

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
    emitIpcToken('code', agentsPath, { configDir: options?.configDir });
    p.outro(`Emitted IPC token to open master AGENTS.md in VS Code (${agentsPath}).`);
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
export async function interactiveAdopt(options?: TuiOptions): Promise<'exit' | void> {
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
        emitIpcToken('code', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to open ${result.name} in VS Code.`);
        return 'exit';
      } else if (nextAction === 'jump') {
        emitIpcToken('cd', result.path, { configDir: options?.configDir });
        p.outro(`Emitted IPC token to jump to ${result.path}.`);
        return 'exit';
      }
    }
  } catch (err: unknown) {
    s.stop('Failed to adopt folder.');
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Evaluates and prompts the user for handling expired throwaway scratchpads on startup.
 */
export async function handleExpiredThrowaways(options?: TuiOptions): Promise<void> {
  const expired = checkExpiredThrowaways({
    configDir: options?.configDir,
    now: options?.now,
  });

  if (expired.length === 0) {
    return;
  }

  p.note(
    `Found ${expired.length} expired throwaway scratchpad(s):\n${expired.map((e) => `• ${e.name} (expired: ${e.expiresAt})`).join('\n')}`,
    'Expired Scratchpads Detected'
  );

  for (const record of expired) {
    const action = await p.select({
      message: `Action for expired scratchpad "${record.name}":`,
      options: [
        {
          value: 'delete',
          label: '🗑️ Delete',
          hint: 'Permanently remove from disk and config',
        },
        {
          value: 'extend',
          label: '⏳ Extend (+3d)',
          hint: 'Extend expiration by 3 days',
        },
        {
          value: 'graduate',
          label: '🎓 Graduate',
          hint: 'Migrate to permanent project & init Git tracking',
        },
        {
          value: 'skip',
          label: '⏭️ Skip',
          hint: 'Keep unchanged and continue',
        },
      ],
    });

    if (p.isCancel(action) || action === 'skip') {
      continue;
    }

    if (action === 'delete') {
      const s = p.spinner();
      s.start(`Deleting throwaway "${record.name}"...`);
      try {
        deleteThrowaway(record.name, { configDir: options?.configDir });
        s.stop(`Deleted throwaway "${record.name}".`);
      } catch (err: unknown) {
        s.stop(`Failed to delete "${record.name}".`);
        p.log.error(err instanceof Error ? err.message : String(err));
      }
    } else if (action === 'extend') {
      const s = p.spinner();
      s.start(`Extending throwaway "${record.name}" by 3 days...`);
      try {
        const updated = extendThrowaway(record.name, 3, { configDir: options?.configDir });
        s.stop(`Extended "${record.name}" (new expiration: ${updated.expiresAt}).`);
      } catch (err: unknown) {
        s.stop(`Failed to extend "${record.name}".`);
        p.log.error(err instanceof Error ? err.message : String(err));
      }
    } else if (action === 'graduate') {
      const s = p.spinner();
      s.start(`Graduating throwaway "${record.name}" to canonical workspace...`);
      try {
        const grad = await graduateThrowaway(record.name, { configDir: options?.configDir });
        s.stop(`Graduated "${record.name}" to ${grad.path}.`);
      } catch (err: unknown) {
        s.stop(`Failed to graduate "${record.name}".`);
        p.log.error(err instanceof Error ? err.message : String(err));
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
      case 'new': {
        const result = await interactiveNewProject(options);
        if (result === 'exit') {
          running = false;
        }
        break;
      }
      case 'scratch': {
        const result = await interactiveThrowaway(options);
        if (result === 'exit') {
          running = false;
        }
        break;
      }
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
          } catch (err: unknown) {
            p.log.error(err instanceof Error ? err.message : String(err));
          }
        }
        break;
      }
      case 'undo':
        await interactiveRollback(options?.cwd || process.cwd(), options);
        break;
      case 'adopt': {
        const result = await interactiveAdopt(options);
        if (result === 'exit') {
          running = false;
        }
        break;
      }
      case 'rules':
        await interactiveRules(options);
        break;
      case 'doctor':
        await interactiveDoctor(options);
        break;
    }
  }
}
