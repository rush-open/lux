import type { CryptoService } from './crypto.js';

export type VaultScope = 'platform' | 'project';

export interface VaultEntry {
  id: string;
  scope: VaultScope;
  projectId: string | null;
  ownerId: string | null;
  name: string;
  credentialType: string;
  keyVersion: number;
  injectionTarget: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreOptions {
  projectId?: string;
  ownerId?: string;
  credentialType?: string;
  injectionTarget?: string;
}

export interface VaultStorage {
  upsert(entry: {
    scope: VaultScope;
    projectId: string | null;
    ownerId: string | null;
    name: string;
    credentialType: string;
    encryptedValue: string;
    keyVersion: number;
    injectionTarget: string | null;
  }): Promise<VaultEntry>;

  findByName(
    scope: VaultScope,
    name: string,
    projectId?: string | null
  ): Promise<{ entry: VaultEntry; encryptedValue: string } | null>;

  listByScope(scope: VaultScope, projectId?: string | null): Promise<VaultEntry[]>;

  remove(scope: VaultScope, name: string, projectId?: string | null): Promise<boolean>;

  countByScope(scope: VaultScope, projectId?: string | null): Promise<number>;

  findAllForInjection(projectId: string): Promise<
    Array<{
      name: string;
      encryptedValue: string;
      scope: VaultScope;
      injectionTarget: string | null;
    }>
  >;

  /**
   * Id-based lookup used by the v1 `/api/v1/vaults/entries/:id` route
   * (DELETE + membership check). Returns null when the id is unknown.
   */
  findById(id: string): Promise<VaultEntry | null>;

  /**
   * Delete by id. Returns true if a row was removed, false if the id did
   * not exist.
   */
  removeById(id: string): Promise<boolean>;

  /**
   * List entries across one or more scopes, used by the v1 list endpoint:
   * - `includePlatform=true`  → platform entries included
   * - `projectIds` non-empty  → project entries for those ids are included
   * - both false/empty        → returns []
   *
   * Ordered `created_at DESC, id DESC` for deterministic pagination.
   */
  listForAccess(filter: { includePlatform: boolean; projectIds: string[] }): Promise<VaultEntry[]>;
}

export class VaultService {
  constructor(
    private crypto: CryptoService,
    private storage: VaultStorage
  ) {}

  static readonly MAX_CREDENTIALS_PER_SCOPE = 20;

  async store(
    scope: VaultScope,
    name: string,
    plaintext: string,
    opts: StoreOptions = {}
  ): Promise<VaultEntry> {
    this.validateProjectId(scope, opts.projectId);

    const existing = await this.storage.findByName(scope, name, opts.projectId);
    if (!existing) {
      const count = await this.storage.countByScope(scope, opts.projectId);
      if (count >= VaultService.MAX_CREDENTIALS_PER_SCOPE) {
        throw new Error(
          `Maximum ${VaultService.MAX_CREDENTIALS_PER_SCOPE} credentials per scope reached`
        );
      }
    }

    const encrypted = this.crypto.encrypt(plaintext);
    return this.storage.upsert({
      scope,
      projectId: scope === 'project' ? (opts.projectId ?? null) : null,
      ownerId: opts.ownerId ?? null,
      name,
      credentialType: opts.credentialType ?? 'env_var',
      encryptedValue: encrypted,
      keyVersion: 1,
      injectionTarget: opts.injectionTarget ?? null,
    });
  }

  async retrieve(scope: VaultScope, name: string, projectId?: string): Promise<string | null> {
    this.validateProjectId(scope, projectId);
    const result = await this.storage.findByName(scope, name, projectId);
    if (!result) return null;
    return this.crypto.decrypt(result.encryptedValue);
  }

  async list(scope: VaultScope, projectId?: string): Promise<VaultEntry[]> {
    this.validateProjectId(scope, projectId);
    return this.storage.listByScope(scope, projectId);
  }

  async remove(scope: VaultScope, name: string, projectId?: string): Promise<boolean> {
    this.validateProjectId(scope, projectId);
    return this.storage.remove(scope, name, projectId);
  }

  private validateProjectId(scope: VaultScope, projectId?: string): void {
    if (scope === 'project' && !projectId) {
      throw new Error('projectId is required for project-scoped credentials');
    }
  }

  /**
   * Id-based lookup used by `/api/v1/vaults/entries/:id` (DELETE flow needs
   * to know the row's scope + projectId to run the right membership check).
   * Returns null if no such id exists.
   */
  async findById(id: string): Promise<VaultEntry | null> {
    return this.storage.findById(id);
  }

  /**
   * Id-based delete used by `/api/v1/vaults/entries/:id`. Returns true when
   * a row was removed. Callers MUST run membership checks BEFORE calling
   * this; this method does not enforce any authorization.
   */
  async removeById(id: string): Promise<boolean> {
    return this.storage.removeById(id);
  }

  /**
   * Union list of platform + project entries the caller can see. The route
   * layer computes the inputs: `includePlatform=true` only for session
   * callers (per spec §资源归属校验), `projectIds` for the caller's
   * project memberships.
   */
  async listForAccess(filter: {
    includePlatform: boolean;
    projectIds: string[];
  }): Promise<VaultEntry[]> {
    if (!filter.includePlatform && filter.projectIds.length === 0) return [];
    return this.storage.listForAccess(filter);
  }

  async resolveForSandbox(projectId: string, _userId?: string): Promise<Record<string, string>> {
    const entries = await this.storage.findAllForInjection(projectId);
    const env: Record<string, string> = {};

    const platformEntries = entries.filter((e) => e.scope === 'platform');
    const projectEntries = entries.filter((e) => e.scope === 'project');

    for (const entry of platformEntries) {
      const target = entry.injectionTarget ?? entry.name;
      env[target] = this.crypto.decrypt(entry.encryptedValue);
    }

    for (const entry of projectEntries) {
      const target = entry.injectionTarget ?? entry.name;
      env[target] = this.crypto.decrypt(entry.encryptedValue);
    }

    return env;
  }
}
