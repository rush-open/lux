/**
 * 统一的变量注入模块
 *
 * 所有 prompt 和 knowledge 文件中的变量替换都在这里集中管理，
 * 确保变量名一致、替换逻辑统一，避免遗漏。
 */

/**
 * 所有支持的变量定义
 */
export interface PromptVariables {
  /** 工作空间路径（如 /workspace/） */
  workspacePath: string;
  /** 项目 ID（如 p_abc123） */
  projectId: string;
  /** API 基础 URL（如 http://localhost:8787） */
  podApiBaseUrl: string;
}

/**
 * 变量占位符映射表
 *
 * 支持的占位符格式：
 * - ${variableName}
 * - ${VARIABLE_NAME}（兼容旧格式）
 */
const VARIABLE_PATTERNS: Array<{
  pattern: RegExp;
  variableKey: keyof PromptVariables;
}> = [
  // workspacePath 的多种写法
  { pattern: /\$\{workspacePath\}/g, variableKey: 'workspacePath' },
  { pattern: /\$\{WORKSPACE_PATH\}/g, variableKey: 'workspacePath' },
  { pattern: /\$\{workspace_path\}/g, variableKey: 'workspacePath' },

  // projectId 的多种写法
  { pattern: /\$\{projectId\}/g, variableKey: 'projectId' },
  { pattern: /\$\{PROJECT_ID\}/g, variableKey: 'projectId' },
  { pattern: /\$\{project_id\}/g, variableKey: 'projectId' },

  // podApiBaseUrl 的多种写法
  { pattern: /\$\{podApiBaseUrl\}/g, variableKey: 'podApiBaseUrl' },
  { pattern: /\$\{POD_API_BASE_URL\}/g, variableKey: 'podApiBaseUrl' },
  { pattern: /\$\{pod_api_base_url\}/g, variableKey: 'podApiBaseUrl' },
];

/**
 * 注入变量到文本中
 *
 * @param text 包含变量占位符的文本
 * @param variables 变量值
 * @returns 替换后的文本
 *
 * @example
 * ```typescript
 * const result = injectVariables(
 *   'cd ${workspacePath}${projectId}',
 *   { workspacePath: '/workspace/', projectId: 'my-project', podApiBaseUrl: 'http://localhost:8787' }
 * );
 * // result: 'cd /workspace/my-project'
 * ```
 */
export function injectVariables(text: string, variables: PromptVariables): string {
  let result = text;

  for (const { pattern, variableKey } of VARIABLE_PATTERNS) {
    const value = variables[variableKey];
    result = result.replace(pattern, value);
  }

  return result;
}

/**
 * 检查文本中是否还有未替换的**已知**变量
 *
 * 只检查 VARIABLE_PATTERNS 中声明的变量占位符，不会匹配代码示例中
 * 的 JS 模板字符串（如 `${total}`）等无关模式。
 *
 * @param text 要检查的文本
 * @returns 未替换的已知变量列表
 */
export function findUnresolvedVariables(text: string): string[] {
  const found: string[] = [];
  for (const { pattern } of VARIABLE_PATTERNS) {
    const fresh = new RegExp(pattern.source, pattern.flags);
    if (fresh.test(text)) {
      const placeholder = text.match(fresh)?.[0];
      if (placeholder && !found.includes(placeholder)) {
        found.push(placeholder);
      }
    }
  }
  return found;
}

/**
 * 注入变量并验证是否有遗漏
 *
 * @param text 包含变量占位符的文本
 * @param variables 变量值
 * @param options 选项
 * @returns 替换后的文本
 * @throws 如果 throwOnUnresolved 为 true 且存在未替换的变量
 */
export function injectVariablesWithValidation(
  text: string,
  variables: PromptVariables,
  options: { throwOnUnresolved?: boolean; warnOnUnresolved?: boolean } = {}
): string {
  const { throwOnUnresolved = true, warnOnUnresolved = true } = options;

  const result = injectVariables(text, variables);
  const unresolved = findUnresolvedVariables(result);

  if (unresolved.length > 0) {
    const message = `[VariableInjector] 发现未替换的变量: ${unresolved.join(', ')}`;

    if (throwOnUnresolved) {
      throw new Error(message);
    }

    if (warnOnUnresolved) {
      console.warn(message);
    }
  }

  return result;
}

/**
 * 创建默认变量配置
 *
 * @param partial 部分变量值
 * @returns 完整的变量配置
 */
export function createDefaultVariables(
  partial: Partial<PromptVariables> & Pick<PromptVariables, 'workspacePath' | 'projectId'>
): PromptVariables {
  return {
    workspacePath: partial.workspacePath,
    projectId: partial.projectId,
    podApiBaseUrl: partial.podApiBaseUrl ?? 'http://localhost:8787',
  };
}
