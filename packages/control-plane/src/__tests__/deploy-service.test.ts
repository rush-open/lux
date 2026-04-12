import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DeployService, type DeployStorage } from '../deploy/deploy-service.js';

class MockDeployStorage implements DeployStorage {
  uploads: Array<{ localPath: string; remotePath: string }> = [];

  async uploadDirectory(localPath: string, remotePath: string) {
    this.uploads.push({ localPath, remotePath });
    return { fileCount: 5, totalSize: 10240 };
  }

  getPublicUrl(path: string): string | null {
    return `https://s3.example.com/${path}`;
  }
}

describe('DeployService', () => {
  let storage: MockDeployStorage;
  const projectId = randomUUID();
  const versionId = randomUUID();

  beforeEach(() => {
    storage = new MockDeployStorage();
  });

  describe('deploy', () => {
    it('uploads build output to storage', async () => {
      const service = new DeployService({ storageBucket: 'test' }, storage);
      const _result = await service.deploy(projectId, versionId, '/tmp/build');

      expect(storage.uploads).toHaveLength(1);
      expect(storage.uploads[0].localPath).toBe('/tmp/build');
      expect(storage.uploads[0].remotePath).toContain(projectId);
      expect(storage.uploads[0].remotePath).toContain(versionId);
    });

    it('returns deploy result with storage URL', async () => {
      const service = new DeployService({ storageBucket: 'test' }, storage);
      const result = await service.deploy(projectId, versionId, '/tmp/build');

      expect(result.versionId).toBe(versionId);
      expect(result.projectId).toBe(projectId);
      expect(result.url).toContain('s3.example.com');
      expect(result.deployedAt).toBeInstanceOf(Date);
    });

    it('uses CDN URL when configured', async () => {
      const service = new DeployService(
        { storageBucket: 'test', cdnBaseUrl: 'https://cdn.rush.dev' },
        storage
      );
      const result = await service.deploy(projectId, versionId, '/tmp/build');
      expect(result.url).toBe(`https://cdn.rush.dev/${projectId}/${versionId}/`);
    });

    it('uses custom storage prefix', async () => {
      const service = new DeployService(
        { storageBucket: 'test', storagePrefix: 'custom' },
        storage
      );
      await service.deploy(projectId, versionId, '/tmp/build');
      expect(storage.uploads[0].remotePath).toMatch(/^custom\//);
    });
  });

  describe('getDeployUrl', () => {
    it('returns CDN URL when configured', () => {
      const service = new DeployService(
        { storageBucket: 'test', cdnBaseUrl: 'https://cdn.rush.dev' },
        storage
      );
      const url = service.getDeployUrl(projectId, versionId);
      expect(url).toBe(`https://cdn.rush.dev/${projectId}/${versionId}/`);
    });

    it('falls back to storage URL', () => {
      const service = new DeployService({ storageBucket: 'test' }, storage);
      const url = service.getDeployUrl(projectId, versionId);
      expect(url).toContain('s3.example.com');
    });
  });
});
