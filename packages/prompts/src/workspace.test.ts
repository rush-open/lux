import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureProjectDir,
  getProjectPath,
  getWorkspacePath,
  getWorkspacePathWithSlash,
  isPathInWorkspace,
  resetWorkspaceCache,
  validateProjectId,
} from './workspace.js';

describe('workspace', () => {
  const testWorkspace = join(tmpdir(), 'lux-workspace-test');

  beforeEach(() => {
    process.env.WORKSPACE_PATH = testWorkspace;
    resetWorkspaceCache();
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true });
    }
  });

  afterEach(() => {
    delete process.env.WORKSPACE_PATH;
    resetWorkspaceCache();
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true });
    }
  });

  describe('getWorkspacePath', () => {
    it('should use WORKSPACE_PATH env var', () => {
      const result = getWorkspacePath();
      expect(result).toBe(testWorkspace);
    });

    it('should create directory if not exists', () => {
      expect(existsSync(testWorkspace)).toBe(false);
      getWorkspacePath();
      expect(existsSync(testWorkspace)).toBe(true);
    });
  });

  describe('getWorkspacePathWithSlash', () => {
    it('should append trailing slash', () => {
      const result = getWorkspacePathWithSlash();
      expect(result).toBe(`${testWorkspace}/`);
    });
  });

  describe('getProjectPath', () => {
    it('should join workspace and projectId', () => {
      const result = getProjectPath('p_abc123');
      expect(result).toBe(join(testWorkspace, 'p_abc123'));
    });
  });

  describe('ensureProjectDir', () => {
    it('should create project directory', () => {
      const projectPath = ensureProjectDir('p_test');
      expect(existsSync(projectPath)).toBe(true);
      expect(projectPath).toBe(join(testWorkspace, 'p_test'));
    });

    it('should reject invalid projectId with path traversal', () => {
      expect(() => ensureProjectDir('../../etc')).toThrow('Invalid projectId');
      expect(() => ensureProjectDir('../hack')).toThrow('Invalid projectId');
    });

    it('should reject empty projectId', () => {
      expect(() => ensureProjectDir('')).toThrow('Invalid projectId');
    });
  });

  describe('validateProjectId', () => {
    it('should accept valid projectIds', () => {
      expect(() => validateProjectId('p_abc123')).not.toThrow();
      expect(() => validateProjectId('my-project')).not.toThrow();
      expect(() => validateProjectId('project.v2')).not.toThrow();
      expect(() => validateProjectId('a')).not.toThrow();
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateProjectId('../../etc')).toThrow('Invalid projectId');
      expect(() => validateProjectId('../hack')).toThrow('Invalid projectId');
      expect(() => validateProjectId('foo/bar')).toThrow('Invalid projectId');
      expect(() => validateProjectId('foo\\bar')).toThrow('Invalid projectId');
    });

    it('should reject empty or dot-starting ids', () => {
      expect(() => validateProjectId('')).toThrow('Invalid projectId');
      expect(() => validateProjectId('.hidden')).toThrow('Invalid projectId');
    });
  });

  describe('isPathInWorkspace', () => {
    it('should return true for paths inside workspace', () => {
      getWorkspacePath();
      expect(isPathInWorkspace(join(testWorkspace, 'p_abc123'))).toBe(true);
      expect(isPathInWorkspace(join(testWorkspace, 'p_abc123', 'src', 'app.ts'))).toBe(true);
    });

    it('should return true for workspace path itself', () => {
      getWorkspacePath();
      expect(isPathInWorkspace(testWorkspace)).toBe(true);
    });

    it('should return false for paths outside workspace', () => {
      getWorkspacePath();
      expect(isPathInWorkspace('/tmp/other')).toBe(false);
      expect(isPathInWorkspace('/home/user/other')).toBe(false);
    });
  });
});
