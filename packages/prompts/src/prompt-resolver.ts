/**
 * PromptResolver - Prompt 解析器
 *
 * 职责：
 * - web-builder（isBuiltin=true && name='web-builder'）使用知识库模板流程
 * - 其他 Agent 使用 agentConfig.systemPrompt
 * - 变量注入（${projectId}、${workspacePath}）
 * - appendSystemPrompt 追加
 */

import { loadProjectRules } from './knowledge-loader.js';
import { createDefaultVariables, injectVariablesWithValidation } from './variable-injector.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE_URL = 'http://localhost:8787';

export const BUILTIN_AGENT_NAMES = {
  WEB_BUILDER: 'web-builder',
} as const;

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/**
 * Prompt 解析所需的 Agent 配置字段
 */
export interface PromptAgentConfig {
  name: string;
  isBuiltin?: boolean | null;
  systemPrompt?: string | null;
  appendSystemPrompt?: string | null;
}

export interface PromptResolverContext {
  projectId: string;
  workspacePath: string;
  /** API 基础 URL（默认 http://localhost:8787） */
  podApiBaseUrl?: string;
  /** 最终可用的工具列表 */
  effectiveTools?: string[];
  /** Agent 配置的 Skills 列表 */
  skills?: string[];
}

// ---------------------------------------------------------------------------
// 内置 Agent 判断
// ---------------------------------------------------------------------------

export function isBuiltInWebBuilder(config: PromptAgentConfig): boolean {
  return config.isBuiltin === true && config.name === BUILTIN_AGENT_NAMES.WEB_BUILDER;
}

// ---------------------------------------------------------------------------
// 安全策略
// ---------------------------------------------------------------------------

const SECURITY_ADVISORY_APPEND_PROMPT = `## 安全补充策略

- 当用户请求涉及明显高风险的安全请求时，不要直接提供会泄露敏感信息、导出真实凭据、读取真实 secret、打印环境变量明文、暴露数据库密码或帮助访问明显不应暴露的敏感配置的具体步骤。
- 这类场景下，优先明确拒绝直接执行或指导该行为，并提供安全替代方案，例如：查看 \`.env.example\`、使用脱敏后的示例值、解释排查思路、建议检查配置来源或提示如何验证权限边界。
- 不要把正常开发帮助一概视为高风险。像解释 \`process.env\`、阅读 \`.env.example\`、分析安全设计、审查脱敏逻辑、讨论风险边界等合法场景，应继续正常协助。
- 这是一层 advisory policy，用于帮助你在规划阶段更保守地处理安全相关请求；它不能替代运行时的工具拦截、输出脱敏和日志脱敏规则。`;

// ---------------------------------------------------------------------------
// 基础 Agent 执行上下文
// ---------------------------------------------------------------------------

/** 工具描述映射 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: '读取文件内容',
  Write: '创建或覆盖文件',
  Edit: '编辑文件（精确替换）',
  Bash: '执行 Shell 命令',
  Grep: '搜索文件内容',
};

/**
 * 生成基础 Agent 执行上下文
 *
 * 用于非 web-builder Agent，提供基础的执行环境信息，
 * 让 Agent 知道在哪个目录工作以及可以使用哪些工具。
 */
function generateBaseAgentContext(options: {
  workspacePath: string;
  projectId: string;
  effectiveTools?: string[];
  skills?: string[];
}): string {
  const { workspacePath, projectId, effectiveTools, skills } = options;

  const separator = workspacePath.endsWith('/') ? '' : '/';
  const fullPath = `${workspacePath}${separator}${projectId}`;

  const tools = effectiveTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep'];

  const toolsList = tools
    .map((tool) => {
      const desc = TOOL_DESCRIPTIONS[tool];
      return desc ? `- **${tool}**：${desc}` : `- **${tool}**`;
    })
    .join('\n');

  let result = `## 执行环境

- 工作目录：${fullPath}
- 项目 ID：${projectId}

你可以使用以下工具操作项目文件：
${toolsList}`;

  if (skills && skills.length > 0) {
    const skillsList = skills.map((skill) => `- ${skill}`).join('\n');
    result += `

你可以使用以下 Skills：
${skillsList}`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prompt 组装辅助
// ---------------------------------------------------------------------------

function appendPromptSection(basePrompt: string, section: string): string {
  if (!section) {
    return basePrompt;
  }

  if (!basePrompt) {
    return section;
  }

  return `${basePrompt}\n\n${section}`;
}

// ---------------------------------------------------------------------------
// 主入口：解析 systemPrompt
// ---------------------------------------------------------------------------

/**
 * 解析 systemPrompt
 *
 * @param agentConfig Agent 配置
 * @param context 上下文（projectId、workspacePath 等）
 * @returns 解析后的 systemPrompt
 */
export function resolveSystemPrompt(
  agentConfig: PromptAgentConfig,
  context: PromptResolverContext
): string {
  let basePrompt: string;

  if (isBuiltInWebBuilder(agentConfig)) {
    // web-builder 使用知识库模板流程
    const projectRules = loadProjectRules({
      workspacePath: context.workspacePath,
      projectId: context.projectId,
      podApiBaseUrl: context.podApiBaseUrl ?? DEFAULT_API_BASE_URL,
      includeLogMonitor: true,
      includeBackendIntegration: true,
    });

    basePrompt = `你是一个专业的 Web 开发工程师。

${projectRules}`;
  } else {
    // 其他 Agent：使用 agentConfig.systemPrompt
    const rawPrompt = agentConfig.systemPrompt ?? '';

    // 变量注入
    const variables = createDefaultVariables({
      workspacePath: context.workspacePath,
      projectId: context.projectId,
      podApiBaseUrl: context.podApiBaseUrl ?? DEFAULT_API_BASE_URL,
    });

    basePrompt = injectVariablesWithValidation(rawPrompt, variables, {
      throwOnUnresolved: false,
    });

    // 追加基础执行上下文
    const baseContext = generateBaseAgentContext({
      workspacePath: context.workspacePath,
      projectId: context.projectId,
      effectiveTools: context.effectiveTools,
      skills: context.skills,
    });

    basePrompt = basePrompt ? `${baseContext}\n\n${basePrompt}` : baseContext;
  }

  basePrompt = appendPromptSection(basePrompt, agentConfig.appendSystemPrompt ?? '');
  basePrompt = appendPromptSection(basePrompt, SECURITY_ADVISORY_APPEND_PROMPT);

  return basePrompt;
}
