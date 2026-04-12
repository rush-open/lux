export interface DeployConfig {
  storageBucket: string;
  cdnBaseUrl?: string;
  storagePrefix?: string;
}

export interface DeployResult {
  versionId: string;
  projectId: string;
  storagePath: string;
  url: string | null;
  deployedAt: Date;
}

export interface DeployStorage {
  uploadDirectory(
    localPath: string,
    remotePath: string
  ): Promise<{ fileCount: number; totalSize: number }>;
  getPublicUrl(path: string): string | null;
}

export class DeployService {
  constructor(
    private config: DeployConfig,
    private storage: DeployStorage
  ) {}

  async deploy(
    projectId: string,
    versionId: string,
    buildOutputPath: string
  ): Promise<DeployResult> {
    const prefix = this.config.storagePrefix ?? 'deploys';
    const remotePath = `${prefix}/${projectId}/${versionId}`;

    await this.storage.uploadDirectory(buildOutputPath, remotePath);

    const url = this.config.cdnBaseUrl
      ? `${this.config.cdnBaseUrl}/${projectId}/${versionId}/`
      : this.storage.getPublicUrl(remotePath);

    return {
      versionId,
      projectId,
      storagePath: remotePath,
      url,
      deployedAt: new Date(),
    };
  }

  getDeployUrl(projectId: string, versionId: string): string | null {
    if (this.config.cdnBaseUrl) {
      return `${this.config.cdnBaseUrl}/${projectId}/${versionId}/`;
    }
    const prefix = this.config.storagePrefix ?? 'deploys';
    return this.storage.getPublicUrl(`${prefix}/${projectId}/${versionId}`);
  }
}
