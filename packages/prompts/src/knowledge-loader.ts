/**
 * 知识库加载器
 *
 * 从本地 markdown 文件加载知识库内容，替代 Langfuse 的远程 prompt 管理。
 * 所有知识库文件统一存放在 packages/prompts/knowledge/ 目录下。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultVariables,
  injectVariablesWithValidation,
  type PromptVariables,
} from './variable-injector.js';

/** 变量注入选项：不抛异常，仅警告 */
const LENIENT_INJECT_OPTIONS = { throwOnUnresolved: false, warnOnUnresolved: true } as const;

/**
 * 知识库加载配置
 */
export interface KnowledgeLoadConfig {
  workspacePath: string;
  projectId: string;
  /** API 基础 URL，默认 http://localhost:8787 */
  podApiBaseUrl?: string;
  /** 是否包含日志监控规范，默认 true */
  includeLogMonitor?: boolean;
  /** 是否包含后端集成规范，默认 false */
  includeBackendIntegration?: boolean;
}

/**
 * 获取 knowledge 目录路径
 *
 * 兼容 ESM 和 CJS：使用 import.meta.url 获取当前文件目录
 */
function getKnowledgePath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, '..', 'knowledge');
}

/**
 * 安全读取知识库文件
 */
function readKnowledgeFile(filename: string): string | null {
  const filePath = join(getKnowledgePath(), filename);
  if (!existsSync(filePath)) {
    console.warn(`[Knowledge] 文件不存在: ${filePath}`);
    return null;
  }
  return readFileSync(filePath, 'utf-8');
}

/**
 * 加载日志监控规范
 *
 * @param variables 变量配置
 * @returns 日志监控规范内容
 */
export function loadLogMonitorRules(variables: PromptVariables): string {
  const content = readKnowledgeFile('log-monitor-rules.md');

  if (!content) {
    return getDefaultLogMonitorRules(variables);
  }

  return injectVariablesWithValidation(content, variables, LENIENT_INJECT_OPTIONS);
}

/**
 * 加载后端集成规范
 *
 * @param variables 变量配置
 * @returns 后端集成规范内容
 */
export function loadBackendIntegrationRules(variables: PromptVariables): string {
  const content = readKnowledgeFile('backend-integration-rules.md');

  if (!content) {
    return getDefaultBackendIntegrationRules();
  }

  return injectVariablesWithValidation(content, variables, LENIENT_INJECT_OPTIONS);
}

/**
 * 加载项目创建规范（核心规范）
 *
 * 工作流程：
 *
 * ```
 * loadProjectRules()
 *   ↓
 * 1. 读取本地 create-project-rules.md
 *   ↓
 * 2. 变量注入（workspacePath, projectId, podApiBaseUrl）
 *   ↓
 * 3. 根据配置追加日志监控/后端集成规范
 *   ↓
 * 4. 返回最终内容
 * ```
 */
export function loadProjectRules(config: KnowledgeLoadConfig): string {
  const {
    workspacePath,
    projectId,
    podApiBaseUrl = 'http://localhost:8787',
    includeLogMonitor = true,
    includeBackendIntegration = false,
  } = config;

  // 创建统一的变量配置
  const variables = createDefaultVariables({
    workspacePath,
    projectId,
    podApiBaseUrl,
  });

  const content = readKnowledgeFile('create-project-rules.md');

  if (!content) {
    return '<!-- 项目创建规范文件不存在 -->';
  }

  // 变量注入
  let result = injectVariablesWithValidation(content, variables, LENIENT_INJECT_OPTIONS);

  // 根据配置追加额外规范
  const appendix: string[] = [];

  if (includeLogMonitor) {
    appendix.push(loadLogMonitorRules(variables));
  }

  if (includeBackendIntegration) {
    appendix.push(loadBackendIntegrationRules(variables));
  }

  if (appendix.length > 0) {
    result += `\n\n---\n\n${appendix.join('\n\n---\n\n')}`;
  }

  return result;
}

/**
 * 获取默认的日志监控规范（当 log-monitor-rules.md 文件不存在时的最小化降级方案）
 */
function getDefaultLogMonitorRules(variables: PromptVariables): string {
  const { workspacePath, projectId } = variables;

  return `## 日志监控（降级规范）

📂 **日志位置**：\`${workspacePath}${projectId}/dev-server.log\`

⚠️ 遇到任何异常时，使用 \`read_file\` 工具读取日志排查问题。`;
}

/**
 * 获取默认的后端集成规范（当 backend-integration-rules.md 文件不存在时的最小化降级方案）
 */
function getDefaultBackendIntegrationRules(): string {
  return `## 后端集成（降级规范）

⚠️ 后端集成规范文件不存在，请参考 packages/prompts/knowledge/backend-integration-rules.md 获取完整规范。`;
}
