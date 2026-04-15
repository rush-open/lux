import { describe, expect, it } from 'vitest';
import {
  isBuiltInWebBuilder,
  type PromptAgentConfig,
  type PromptResolverContext,
  resolveSystemPrompt,
} from './prompt-resolver.js';

describe('prompt-resolver', () => {
  const context: PromptResolverContext = {
    projectId: 'p_test123',
    workspacePath: '/workspace/',
    podApiBaseUrl: 'http://localhost:8787',
  };

  describe('isBuiltInWebBuilder', () => {
    it('should return true for web-builder builtin agent', () => {
      expect(isBuiltInWebBuilder({ name: 'web-builder', isBuiltin: true })).toBe(true);
    });

    it('should return false for non-builtin web-builder', () => {
      expect(isBuiltInWebBuilder({ name: 'web-builder', isBuiltin: false })).toBe(false);
    });

    it('should return false for other builtin agents', () => {
      expect(isBuiltInWebBuilder({ name: 'other-agent', isBuiltin: true })).toBe(false);
    });

    it('should return false when isBuiltin is null', () => {
      expect(isBuiltInWebBuilder({ name: 'web-builder', isBuiltin: null })).toBe(false);
    });
  });

  describe('resolveSystemPrompt', () => {
    it('should resolve web-builder prompt with project rules', () => {
      const config: PromptAgentConfig = {
        name: 'web-builder',
        isBuiltin: true,
      };
      const result = resolveSystemPrompt(config, context);

      expect(result).toContain('你是一个专业的 Web 开发工程师');
      expect(result).toContain('项目创建规范');
      expect(result).toContain('安全补充策略');
      // Variables should be injected
      expect(result).toContain('/workspace/');
      expect(result).toContain('p_test123');
      // Should not contain raw variables
      expect(result).not.toContain('${workspacePath}');
      expect(result).not.toContain('${projectId}');
    });

    it('should resolve custom agent prompt with systemPrompt', () => {
      const config: PromptAgentConfig = {
        name: 'my-agent',
        isBuiltin: false,
        systemPrompt: '你是一个代码审查专家，工作目录在 ${workspacePath}${projectId}',
      };
      const result = resolveSystemPrompt(config, context);

      expect(result).toContain('你是一个代码审查专家');
      expect(result).toContain('/workspace/p_test123');
      expect(result).toContain('执行环境');
      expect(result).toContain('安全补充策略');
    });

    it('should append appendSystemPrompt', () => {
      const config: PromptAgentConfig = {
        name: 'web-builder',
        isBuiltin: true,
        appendSystemPrompt: '## 额外规则\n\n- 必须使用中文回复',
      };
      const result = resolveSystemPrompt(config, context);

      expect(result).toContain('额外规则');
      expect(result).toContain('必须使用中文回复');
    });

    it('should include base context for non web-builder agents', () => {
      const config: PromptAgentConfig = {
        name: 'custom-agent',
        systemPrompt: 'Custom instructions',
      };
      const contextWithTools: PromptResolverContext = {
        ...context,
        effectiveTools: ['Read', 'Write', 'Bash'],
        skills: ['code-review'],
      };
      const result = resolveSystemPrompt(config, contextWithTools);

      expect(result).toContain('执行环境');
      expect(result).toContain('**Read**');
      expect(result).toContain('**Write**');
      expect(result).toContain('**Bash**');
      expect(result).toContain('code-review');
      expect(result).toContain('Custom instructions');
    });

    it('should handle empty systemPrompt for custom agent', () => {
      const config: PromptAgentConfig = {
        name: 'empty-agent',
      };
      const result = resolveSystemPrompt(config, context);

      expect(result).toContain('执行环境');
      expect(result).toContain('安全补充策略');
    });
  });
});
