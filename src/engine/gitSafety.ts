import path from 'node:path';
import fs from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import pc from 'picocolors';
import { SAFETY_STASH_PREFIX, CHECKPOINT_PREFIX } from '../config/constants.js';
import {
  type CheckpointOptions,
  type CheckpointResult,
  type CheckpointInfo,
  type RollbackOptions,
  type RollbackResult,
} from './types.js';

export { SAFETY_STASH_PREFIX, CHECKPOINT_PREFIX };

/**
 * Formats a Date into a human-readable relative time string.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return 'just now';
  }
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (diffSec < 2592000) {
    const days = Math.floor(diffSec / 86400);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  const months = Math.floor(diffSec / 2592000);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * Ensures the target path is a valid Git repository.
 */
async function ensureGitRepo(cwd: string): Promise<SimpleGit> {
  const resolvedPath = path.resolve(cwd);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Directory does not exist: "${resolvedPath}"`);
  }

  const git = simpleGit(resolvedPath, { maxConcurrentProcesses: 2 });
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Target directory is not a Git repository: "${resolvedPath}"`);
  }
  return git;
}

/**
 * Creates a milestone save-game checkpoint commit with prefix `checkpoint: <message>`.
 */
export async function createCheckpoint(
  cwd: string,
  message: string,
  options?: CheckpointOptions
): Promise<CheckpointResult> {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('Checkpoint message cannot be empty');
  }

  const git = await ensureGitRepo(cwd);

  const trimmed = message.trim();
  const commitMessage = trimmed.toLowerCase().startsWith('checkpoint:')
    ? trimmed
    : `checkpoint: ${trimmed}`;

  // Stage all working directory changes & untracked files
  await git.add('.');

  const status = await git.status();
  if (status.files.length === 0 && !options?.allowEmpty) {
    throw new Error('No changes to commit for checkpoint: working directory is clean');
  }

  if (options?.gitAuthorName) {
    await git.addConfig('user.name', options.gitAuthorName, false, 'local');
  }
  if (options?.gitAuthorEmail) {
    await git.addConfig('user.email', options.gitAuthorEmail, false, 'local');
  }

  await git.commit(commitMessage);
  const commitHash = (await git.revparse(['HEAD'])).trim();
  const shortHash = commitHash.substring(0, 7);

  return {
    hash: commitHash,
    shortHash,
    message: commitMessage,
    timestamp: new Date(),
    filesChanged: status.files.length,
  };
}

/**
 * Lists recent checkpoint commits in the repository.
 */
export async function listCheckpoints(
  cwd: string,
  limit?: number
): Promise<CheckpointInfo[]> {
  const git = await ensureGitRepo(cwd);

  const log = await git.log({ maxCount: 200 });
  const checkpointCommits = log.all.filter((c) =>
    c.message.trim().toLowerCase().startsWith('checkpoint:')
  );

  const limited =
    typeof limit === 'number' && limit > 0
      ? checkpointCommits.slice(0, limit)
      : checkpointCommits;

  const now = new Date();
  return limited.map((c) => {
    const commitDate = new Date(c.date);
    const relTime = formatRelativeTime(commitDate, now);
    return {
      hash: c.hash,
      shortHash: c.hash.substring(0, 7),
      message: c.message,
      date: commitDate,
      timestamp: commitDate,
      relativeTimestamp: relTime,
      relativeTime: relTime,
      authorName: c.author_name,
      authorEmail: c.author_email,
    };
  });
}

/**
 * Safely rolls back the repository to a target checkpoint (or previous checkpoint),
 * automatically creating an emergency safety stash (proj-safety-stash-<timestamp>)
 * if there are dirty or untracked files.
 */
export async function rollbackCheckpoint(
  cwd: string,
  targetCommitHash?: string,
  options?: RollbackOptions
): Promise<RollbackResult> {
  const git = await ensureGitRepo(cwd);

  const log = await git.log({ maxCount: 200 });
  if (log.all.length === 0) {
    throw new Error('Cannot rollback: repository has no commits');
  }

  let resolvedTargetHash = '';
  if (targetCommitHash && targetCommitHash.trim() !== '') {
    try {
      resolvedTargetHash = (await git.revparse([`${targetCommitHash.trim()}^{commit}`])).trim();
    } catch {
      throw new Error(`Target commit "${targetCommitHash}" not found in Git repository`);
    }
  } else {
    // Find target checkpoint commit prior to HEAD or previous commit
    const currentHead = log.all[0].hash;
    const checkpoints = log.all.filter((c) =>
      c.message.trim().toLowerCase().startsWith('checkpoint:')
    );

    const previousCheckpoint = checkpoints.find((c) => c.hash !== currentHead);
    if (previousCheckpoint) {
      resolvedTargetHash = previousCheckpoint.hash;
    } else if (log.all.length >= 2) {
      resolvedTargetHash = log.all[1].hash;
    } else {
      throw new Error('Cannot rollback: no previous checkpoint or commit found to roll back to');
    }
  }

  // Retrieve commit details for target commit
  const showLog = await git.show(['-s', '--format=%B', resolvedTargetHash]);
  const targetMessage = showLog.trim().split('\n')[0] || '';
  const targetShortHash = resolvedTargetHash.substring(0, 7);

  // Check if working tree has dirty or untracked changes
  const status = await git.status();
  const isDirty = !status.isClean() || status.files.length > 0 || status.not_added.length > 0;

  let stashCreated = false;
  let stashName: string | null = null;
  let stashRef: string | null = null;

  if (isDirty) {
    const timestamp = Date.now();
    stashName = `${SAFETY_STASH_PREFIX}${timestamp}`;
    await git.stash(['push', '--include-untracked', '-m', stashName]);
    stashCreated = true;

    try {
      const stashList = await git.stashList();
      const stashIndex = stashList.all.findIndex((s) => s.message.includes(stashName!));
      stashRef = stashIndex >= 0 ? `stash@{${stashIndex}}` : stashName;
    } catch {
      stashRef = stashName;
    }
  }

  // Calculate reverted files between target commit and current HEAD
  let diffSummaryFiles: string[] = [];
  try {
    const diff = await git.diffSummary([resolvedTargetHash, 'HEAD']);
    diffSummaryFiles = diff.files.map((f) => f.file);
  } catch {
    // Fallback
  }

  const allAffectedFiles = Array.from(
    new Set([...diffSummaryFiles, ...status.files.map((f) => f.path)])
  );

  // Perform hard reset to target commit
  await git.reset(['--hard', resolvedTargetHash]);

  // Clean any remaining untracked artifacts
  try {
    await git.clean('f', ['-d']);
  } catch {
    // Ignore clean failures if any
  }

  const summaryLines: string[] = [
    `Successfully rolled back repository to checkpoint ${targetShortHash} ("${targetMessage}").`,
  ];
  if (stashCreated && stashName) {
    summaryLines.push(
      `Safety stash created: "${stashName}" (${stashRef || 'active stash'}). Uncommitted changes were saved.`
    );
  }
  if (allAffectedFiles.length > 0) {
    summaryLines.push(
      `Reverted files (${allAffectedFiles.length}):\n${allAffectedFiles.map((f) => `  - ${f}`).join('\n')}`
    );
  }
  const summary = summaryLines.join('\n');

  return {
    success: true,
    targetHash: resolvedTargetHash,
    targetShortHash,
    targetMessage,
    stashCreated,
    stashName,
    stashRef,
    revertedFiles: allAffectedFiles,
    summary,
  };
}

/**
 * Formats a list of checkpoints into a formatted CLI table.
 */
export function formatCheckpointsTable(checkpoints: CheckpointInfo[]): string {
  if (checkpoints.length === 0) {
    return 'No milestone checkpoints found in repository.';
  }

  const rows = [
    ['HASH', 'TIME', 'CHECKPOINT MESSAGE'],
    ['----', '----', '------------------'],
  ];

  for (const cp of checkpoints) {
    rows.push([
      cp.shortHash,
      cp.relativeTimestamp || formatRelativeTime(cp.timestamp),
      cp.message,
    ]);
  }

  const colWidths = [
    Math.max(...rows.map((r) => r[0].length)),
    Math.max(...rows.map((r) => r[1].length)),
    Math.max(...rows.map((r) => r[2].length)),
  ];

  return rows
    .map((row) =>
      `${row[0].padEnd(colWidths[0])}  ${row[1].padEnd(colWidths[1])}  ${row[2]}`
    )
    .join('\n');
}

/**
 * Formats a rollback result into a human-readable confirmation summary.
 */
export function formatRollbackSummary(result: RollbackResult): string {
  const lines: string[] = [];

  lines.push(
    `${pc.green('✔')} Rolled back to checkpoint ${pc.bold(pc.cyan(result.targetShortHash))} (${pc.italic(result.targetMessage)})`
  );

  if (result.stashCreated && result.stashName) {
    lines.push(
      `${pc.yellow('⚠')} Emergency safety stash created: ${pc.bold(result.stashName)} (${result.stashRef || 'stash'})`
    );
    lines.push(
      `  (To restore stashed uncommitted work later: ${pc.dim(`git stash pop`)})`
    );
  }

  if (result.revertedFiles.length > 0) {
    lines.push(`Reverted ${result.revertedFiles.length} file(s):`);
    for (const f of result.revertedFiles) {
      lines.push(`  - ${f}`);
    }
  } else {
    lines.push('Working tree is clean.');
  }

  return lines.join('\n');
}
