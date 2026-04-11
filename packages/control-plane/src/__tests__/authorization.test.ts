import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  AuthorizationGuard,
  getRolePermissions,
  hasPermission,
  type MembershipInfo,
  type MembershipStore,
} from '../auth/authorization.js';

class InMemoryMembershipStore implements MembershipStore {
  private members = new Map<string, MembershipInfo>();

  add(info: MembershipInfo): void {
    this.members.set(`${info.userId}:${info.projectId}`, info);
  }

  async getMembership(userId: string, projectId: string): Promise<MembershipInfo | null> {
    return this.members.get(`${userId}:${projectId}`) ?? null;
  }
}

describe('getRolePermissions', () => {
  it('owner has all permissions', () => {
    const perms = getRolePermissions('owner');
    expect(perms).toContain('project:read');
    expect(perms).toContain('project:write');
    expect(perms).toContain('project:delete');
    expect(perms).toContain('project:manage_members');
  });

  it('member has read and write', () => {
    const perms = getRolePermissions('member');
    expect(perms).toContain('project:read');
    expect(perms).toContain('project:write');
    expect(perms).not.toContain('project:delete');
    expect(perms).not.toContain('project:manage_members');
  });

  it('admin has read, write, and manage_members', () => {
    const perms = getRolePermissions('admin');
    expect(perms).toContain('project:read');
    expect(perms).toContain('project:write');
    expect(perms).toContain('project:manage_members');
    expect(perms).not.toContain('project:delete');
  });
});

describe('hasPermission', () => {
  it('owner can delete', () => {
    expect(hasPermission('owner', 'project:delete')).toBe(true);
  });

  it('member cannot delete', () => {
    expect(hasPermission('member', 'project:delete')).toBe(false);
  });

  it('member can read', () => {
    expect(hasPermission('member', 'project:read')).toBe(true);
  });
});

describe('AuthorizationGuard', () => {
  let store: InMemoryMembershipStore;
  let guard: AuthorizationGuard;

  beforeEach(() => {
    store = new InMemoryMembershipStore();
    guard = new AuthorizationGuard(store);
  });

  describe('requireMembership', () => {
    it('returns membership for valid member', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'member' });
      const result = await guard.requireMembership('u1', 'p1');
      expect(result.role).toBe('member');
    });

    it('throws AuthorizationError for non-member', async () => {
      await expect(guard.requireMembership('u1', 'p1')).rejects.toThrow(AuthorizationError);
      await expect(guard.requireMembership('u1', 'p1')).rejects.toThrow('Not a member');
    });

    it('AuthorizationError contains userId and projectId', async () => {
      const error = await guard.requireMembership('u1', 'p1').catch((e) => e);
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.userId).toBe('u1');
      expect(error.projectId).toBe('p1');
    });
  });

  describe('requirePermission', () => {
    it('allows owner to delete', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'owner' });
      const result = await guard.requirePermission('u1', 'p1', 'project:delete');
      expect(result.role).toBe('owner');
    });

    it('denies member from deleting', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'member' });
      await expect(guard.requirePermission('u1', 'p1', 'project:delete')).rejects.toThrow(
        'Missing permission'
      );
    });

    it('allows member to read', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'member' });
      const result = await guard.requirePermission('u1', 'p1', 'project:read');
      expect(result.role).toBe('member');
    });

    it('denies non-member entirely', async () => {
      await expect(guard.requirePermission('u1', 'p1', 'project:read')).rejects.toThrow(
        'Not a member'
      );
    });
  });

  describe('requireOwner', () => {
    it('allows owner', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'owner' });
      const result = await guard.requireOwner('u1', 'p1');
      expect(result.role).toBe('owner');
    });

    it('denies member', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'member' });
      await expect(guard.requireOwner('u1', 'p1')).rejects.toThrow('Owner role required');
    });

    it('denies admin', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'admin' });
      await expect(guard.requireOwner('u1', 'p1')).rejects.toThrow('Owner role required');
    });

    it('denies non-member', async () => {
      await expect(guard.requireOwner('u1', 'p1')).rejects.toThrow('Not a member');
    });
  });

  describe('cross-project isolation', () => {
    it('membership in one project does not grant access to another', async () => {
      store.add({ userId: 'u1', projectId: 'p1', role: 'owner' });
      await expect(guard.requireMembership('u1', 'p2')).rejects.toThrow(AuthorizationError);
    });
  });
});
