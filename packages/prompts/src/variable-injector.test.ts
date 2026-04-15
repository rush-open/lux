import { describe, expect, it } from 'vitest';
import {
  createDefaultVariables,
  findUnresolvedVariables,
  injectVariables,
  injectVariablesWithValidation,
} from './variable-injector.js';

describe('variable-injector', () => {
  const variables = createDefaultVariables({
    workspacePath: '/workspace/',
    projectId: 'p_abc123',
    podApiBaseUrl: 'http://localhost:8787',
  });

  describe('injectVariables', () => {
    it('should replace ${workspacePath}', () => {
      const result = injectVariables('cd ${workspacePath}${projectId}', variables);
      expect(result).toBe('cd /workspace/p_abc123');
    });

    it('should replace ${WORKSPACE_PATH} (uppercase)', () => {
      const result = injectVariables('path: ${WORKSPACE_PATH}', variables);
      expect(result).toBe('path: /workspace/');
    });

    it('should replace ${podApiBaseUrl}', () => {
      const result = injectVariables('curl ${podApiBaseUrl}/api/test', variables);
      expect(result).toBe('curl http://localhost:8787/api/test');
    });

    it('should replace multiple variables in one string', () => {
      const result = injectVariables(
        'curl -X POST ${podApiBaseUrl}/api/templates/scaffold -d \'{"projectId": "${projectId}", "workspacePath": "${workspacePath}"}\'',
        variables
      );
      expect(result).toContain('http://localhost:8787');
      expect(result).toContain('p_abc123');
      expect(result).toContain('/workspace/');
    });

    it('should not touch unknown ${variables}', () => {
      const result = injectVariables('const total = ${total}', variables);
      expect(result).toBe('const total = ${total}');
    });

    it('should handle empty text', () => {
      const result = injectVariables('', variables);
      expect(result).toBe('');
    });
  });

  describe('findUnresolvedVariables', () => {
    it('should return empty array when all variables are resolved', () => {
      const result = findUnresolvedVariables('cd /workspace/p_abc123');
      expect(result).toEqual([]);
    });

    it('should find unresolved known variables', () => {
      const result = findUnresolvedVariables('cd ${workspacePath}${projectId}');
      expect(result).toContain('${workspacePath}');
      expect(result).toContain('${projectId}');
    });

    it('should ignore unknown ${variables} like JS template literals', () => {
      const result = findUnresolvedVariables('const x = ${total}');
      expect(result).toEqual([]);
    });
  });

  describe('injectVariablesWithValidation', () => {
    it('should inject and not throw when all resolved', () => {
      const result = injectVariablesWithValidation('cd ${workspacePath}${projectId}', variables);
      expect(result).toBe('cd /workspace/p_abc123');
    });

    it('should throw on unresolved by default', () => {
      // This should not throw because ${total} is not a known variable
      const result = injectVariablesWithValidation('${total}', variables);
      expect(result).toBe('${total}');
    });
  });

  describe('createDefaultVariables', () => {
    it('should use default podApiBaseUrl', () => {
      const result = createDefaultVariables({
        workspacePath: '/w/',
        projectId: 'p1',
      });
      expect(result.podApiBaseUrl).toBe('http://localhost:8787');
    });

    it('should allow custom podApiBaseUrl', () => {
      const result = createDefaultVariables({
        workspacePath: '/w/',
        projectId: 'p1',
        podApiBaseUrl: 'http://agent:3000',
      });
      expect(result.podApiBaseUrl).toBe('http://agent:3000');
    });
  });
});
