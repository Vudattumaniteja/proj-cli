import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  verifyJunction,
  repairJunction,
  runDoctor,
  fixDoctorIssues,
  formatDoctorReport,
  formatDoctorFixReport,
  compareVersions,
} from '../src/engine/doctor.js';
import { ensureConfigDirs } from '../src/config/index.js';
import { writePowerShellWrapper } from '../src/ipc/index.js';

describe('Doctor Diagnostic & Self-Healing Engine', () => {
  let tempDir: string;
  let customConfigDir: string;
  let customProjectsRoot: string;
  let customThrowawaysRoot: string;
  let customDesktopJunction: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-doctor-'));
    customConfigDir = path.join(tempDir, '.proj');
    customProjectsRoot = path.join(tempDir, 'projects');
    customThrowawaysRoot = path.join(customProjectsRoot, 'throwaways');
    customDesktopJunction = path.join(tempDir, 'Desktop', 'Projects');

    fs.mkdirSync(customConfigDir, { recursive: true });
    fs.mkdirSync(customProjectsRoot, { recursive: true });
    fs.mkdirSync(customThrowawaysRoot, { recursive: true });
    fs.mkdirSync(path.dirname(customDesktopJunction), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('compareVersions()', () => {
    it('accurately compares semver version strings', () => {
      expect(compareVersions('2.43.0', '2.20.0')).toBe(1);
      expect(compareVersions('2.20.0', '2.20.0')).toBe(0);
      expect(compareVersions('2.19.0', '2.20.0')).toBe(-1);
      expect(compareVersions('2.43.0.windows.1', '2.20.0')).toBe(1);
      expect(compareVersions('v2.20.0', '2.20.0')).toBe(0);
    });
  });

  describe('verifyJunction()', () => {
    it('returns missing status when junction does not exist', () => {
      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.exists).toBe(false);
      expect(status.isLink).toBe(false);
      expect(status.valid).toBe(false);
      expect(status.targetExists).toBe(true);
      expect(status.actualTarget).toBeNull();
    });

    it('returns valid status when junction correctly points to target root', () => {
      repairJunction(customDesktopJunction, customProjectsRoot);
      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.exists).toBe(true);
      expect(status.isLink).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.targetExists).toBe(true);
      expect(status.actualTarget).toBeDefined();
    });

    it('returns invalid status when junction points to a different directory', () => {
      const otherDir = path.join(tempDir, 'other-dir');
      fs.mkdirSync(otherDir, { recursive: true });
      repairJunction(customDesktopJunction, otherDir);

      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.exists).toBe(true);
      expect(status.isLink).toBe(true);
      expect(status.valid).toBe(false);
      expect(status.message).toContain('points to');
    });

    it('returns invalid status when path is a regular directory instead of a link', () => {
      fs.mkdirSync(customDesktopJunction, { recursive: true });
      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.exists).toBe(true);
      expect(status.isLink).toBe(false);
      expect(status.valid).toBe(false);
      expect(status.message).toContain('regular directory');
    });

    it('detects when junction exists but target directory is missing', () => {
      repairJunction(customDesktopJunction, customProjectsRoot);
      fs.rmSync(customProjectsRoot, { recursive: true, force: true });

      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.isLink).toBe(true);
      expect(status.targetExists).toBe(false);
      expect(status.valid).toBe(false);
    });
  });

  describe('repairJunction()', () => {
    it('creates a new junction when path does not exist', () => {
      const result = repairJunction(customDesktopJunction, customProjectsRoot);
      expect(result.repaired).toBe(true);
      expect(result.action).toBe('created');

      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.valid).toBe(true);
    });

    it('creates target directory if target root is missing', () => {
      const missingTarget = path.join(tempDir, 'missing-projects');
      const result = repairJunction(customDesktopJunction, missingTarget);
      expect(result.repaired).toBe(true);
      expect(fs.existsSync(missingTarget)).toBe(true);

      const status = verifyJunction(customDesktopJunction, missingTarget);
      expect(status.valid).toBe(true);
    });

    it('re-links junction if pointing to incorrect destination', () => {
      const oldDir = path.join(tempDir, 'old-target');
      fs.mkdirSync(oldDir, { recursive: true });
      repairJunction(customDesktopJunction, oldDir);

      const result = repairJunction(customDesktopJunction, customProjectsRoot);
      expect(result.repaired).toBe(true);
      expect(result.action).toBe('re-linked');

      const status = verifyJunction(customDesktopJunction, customProjectsRoot);
      expect(status.valid).toBe(true);
    });

    it('returns already-valid if junction is already healthy', () => {
      repairJunction(customDesktopJunction, customProjectsRoot);
      const result = repairJunction(customDesktopJunction, customProjectsRoot);
      expect(result.repaired).toBe(true);
      expect(result.action).toBe('already-valid');
    });
  });

  describe('runDoctor()', () => {
    it('returns fully healthy report when environment is properly configured', async () => {
      ensureConfigDirs({ configDir: customConfigDir });
      writePowerShellWrapper(undefined, { configDir: customConfigDir });
      repairJunction(customDesktopJunction, customProjectsRoot);

      const report = await runDoctor({
        configDir: customConfigDir,
        projectsRoot: customProjectsRoot,
        throwawaysRoot: customThrowawaysRoot,
        desktopJunctionPath: customDesktopJunction,
      });

      expect(report.allOk).toBe(true);
      expect(report.passedCount).toBe(5);
      expect(report.warningCount).toBe(0);
      expect(report.errorCount).toBe(0);
      expect(report.checks).toHaveLength(5);

      const gitCheck = report.checks.find((c) => c.id === 'git');
      expect(gitCheck?.status).toBe('ok');
      expect(gitCheck?.message).toContain('Git binary available');

      const dirsCheck = report.checks.find((c) => c.id === 'directories');
      expect(dirsCheck?.status).toBe('ok');

      const junctionCheck = report.checks.find((c) => c.id === 'junction');
      expect(junctionCheck?.status).toBe('ok');

      const configCheck = report.checks.find((c) => c.id === 'config');
      expect(configCheck?.status).toBe('ok');

      const ipcCheck = report.checks.find((c) => c.id === 'ipc');
      expect(ipcCheck?.status).toBe('ok');
    });

    it('detects missing directories, junction, config, and IPC wrapper as warnings', async () => {
      const emptyConfigDir = path.join(tempDir, 'empty-config');
      const missingProjects = path.join(tempDir, 'non-existent-projects');
      const missingThrowaways = path.join(missingProjects, 'throwaways');
      const missingJunction = path.join(tempDir, 'Desktop', 'MissingJunction');

      const report = await runDoctor({
        configDir: emptyConfigDir,
        projectsRoot: missingProjects,
        throwawaysRoot: missingThrowaways,
        desktopJunctionPath: missingJunction,
      });

      expect(report.allOk).toBe(false);
      expect(report.warningCount).toBeGreaterThanOrEqual(4);

      const dirsCheck = report.checks.find((c) => c.id === 'directories');
      expect(dirsCheck?.status).toBe('warning');
      expect(dirsCheck?.fixable).toBe(true);

      const junctionCheck = report.checks.find((c) => c.id === 'junction');
      expect(junctionCheck?.status).toBe('warning');
      expect(junctionCheck?.fixable).toBe(true);

      const configCheck = report.checks.find((c) => c.id === 'config');
      expect(configCheck?.status).toBe('warning');
      expect(configCheck?.fixable).toBe(true);

      const ipcCheck = report.checks.find((c) => c.id === 'ipc');
      expect(ipcCheck?.status).toBe('warning');
      expect(ipcCheck?.fixable).toBe(true);
    });

    it('flags Git version warning if Git version is below required minimum', async () => {
      const report = await runDoctor({
        configDir: customConfigDir,
        projectsRoot: customProjectsRoot,
        throwawaysRoot: customThrowawaysRoot,
        desktopJunctionPath: customDesktopJunction,
        gitExec: async () => ({ stdout: 'git version 1.9.0' }),
      });

      const gitCheck = report.checks.find((c) => c.id === 'git');
      expect(gitCheck?.status).toBe('warning');
      expect(gitCheck?.message).toContain('below minimum');
    });

    it('flags Git error if Git binary is completely missing', async () => {
      const report = await runDoctor({
        configDir: customConfigDir,
        projectsRoot: customProjectsRoot,
        throwawaysRoot: customThrowawaysRoot,
        desktopJunctionPath: customDesktopJunction,
        gitExec: async () => {
          throw new Error('spawn git ENOENT');
        },
      });

      const gitCheck = report.checks.find((c) => c.id === 'git');
      expect(gitCheck?.status).toBe('error');
      expect(gitCheck?.message).toContain('not found');
    });
  });

  describe('fixDoctorIssues()', () => {
    it('automatically repairs all fixable issues and returns 100% healthy post-repair report', async () => {
      const emptyConfigDir = path.join(tempDir, 'auto-fix-config');
      const missingProjects = path.join(tempDir, 'auto-fix-projects');
      const missingThrowaways = path.join(missingProjects, 'throwaways');
      const missingJunction = path.join(tempDir, 'Desktop', 'AutoFixJunction');

      const fixReport = await fixDoctorIssues({
        configDir: emptyConfigDir,
        projectsRoot: missingProjects,
        throwawaysRoot: missingThrowaways,
        desktopJunctionPath: missingJunction,
      });

      expect(fixReport.initialReport.allOk).toBe(false);
      expect(fixReport.repairActions.length).toBeGreaterThan(0);
      expect(fixReport.fixedReport.allOk).toBe(true);
      expect(fixReport.fixedReport.passedCount).toBe(5);
      expect(fixReport.fixedReport.warningCount).toBe(0);

      // Verify physical repairs
      expect(fs.existsSync(missingProjects)).toBe(true);
      expect(fs.existsSync(missingThrowaways)).toBe(true);
      expect(fs.existsSync(path.join(emptyConfigDir, 'config.json'))).toBe(true);
      expect(fs.existsSync(path.join(emptyConfigDir, 'templates', 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(emptyConfigDir, 'proj.ps1'))).toBe(true);

      const junctionStatus = verifyJunction(missingJunction, missingProjects);
      expect(junctionStatus.valid).toBe(true);
    });
  });

  describe('Formatters', () => {
    it('formats healthy report with checkmarks and summary', async () => {
      ensureConfigDirs({ configDir: customConfigDir });
      writePowerShellWrapper(undefined, { configDir: customConfigDir });
      repairJunction(customDesktopJunction, customProjectsRoot);

      const report = await runDoctor({
        configDir: customConfigDir,
        projectsRoot: customProjectsRoot,
        throwawaysRoot: customThrowawaysRoot,
        desktopJunctionPath: customDesktopJunction,
      });

      const formatted = formatDoctorReport(report);
      expect(formatted).toContain('System Diagnostics');
      expect(formatted).toContain('Git binary availability');
      expect(formatted).toContain('Desktop Junction health status');
      expect(formatted).toContain('All systems healthy');
    });

    it('formats warning report with guidance to run --fix', async () => {
      const emptyConfigDir = path.join(tempDir, 'unconfigured');
      const report = await runDoctor({
        configDir: emptyConfigDir,
        projectsRoot: path.join(tempDir, 'p1'),
        throwawaysRoot: path.join(tempDir, 'p1', 'throwaways'),
        desktopJunctionPath: path.join(tempDir, 'Desktop', 'P1'),
      });

      const formatted = formatDoctorReport(report);
      expect(formatted).toContain('proj doctor --fix');
    });

    it('formats fix report showing repair actions and post-repair status', async () => {
      const emptyConfigDir = path.join(tempDir, 'unconfigured-fix');
      const fixReport = await fixDoctorIssues({
        configDir: emptyConfigDir,
        projectsRoot: path.join(tempDir, 'p2'),
        throwawaysRoot: path.join(tempDir, 'p2', 'throwaways'),
        desktopJunctionPath: path.join(tempDir, 'Desktop', 'P2'),
      });

      const formatted = formatDoctorFixReport(fixReport);
      expect(formatted).toContain('System Diagnostics & Self-Healing');
      expect(formatted).toContain('Repairs executed');
      expect(formatted).toContain('Post-repair Diagnostic Status');
    });
  });
});
