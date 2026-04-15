/**
 * 模板注册表
 *
 * 管理所有可用的项目模板元数据。
 * 模板实际内容通过 Git 仓库获取（由上层脚手架流程处理），
 * 此处仅管理元数据和匹配逻辑。
 */

import type { TemplateMetadata } from './types.js';

/**
 * 内置模板列表
 *
 * 对应 rush-app 的三套模板：
 * - simple-html: 纯静态页面
 * - react-tailwind-v3: React 组件化应用
 * - nextjs-fullstack: Next.js 全栈应用
 */
const BUILTIN_TEMPLATES: TemplateMetadata[] = [
  {
    id: 'simple-html',
    name: 'Simple HTML',
    description: 'Hello World、纯展示、静态页面、无交互',
    type: 'simple',
    tags: ['html', 'css', 'vite'],
  },
  {
    id: 'react-tailwind-v3',
    name: 'React + Tailwind',
    description: '组件化、交互功能、状态管理、前端应用',
    type: 'complex',
    tags: ['react', 'typescript', 'tailwind', 'vite'],
  },
  {
    id: 'nextjs-fullstack',
    name: 'Next.js Fullstack',
    description: 'API、数据库、SSR/SSG、用户认证、全栈、AI 能力',
    type: 'fullstack',
    tags: ['nextjs', 'typescript', 'fullstack', 'api', 'database'],
  },
];

/**
 * 不在「用户可选模板」中展示的模板 ID。
 * 脚手架工作流仍可通过显式 templateId 解析。
 */
const TEMPLATE_IDS_EXCLUDED_FROM_USER_SELECTION = new Set<string>([]);

function findByType(type: TemplateMetadata['type']): TemplateMetadata | null {
  return BUILTIN_TEMPLATES.find((t) => t.type === type) ?? null;
}

// ---------------------------------------------------------------------------
// 关键词匹配规则（按优先级从高到低）
// ---------------------------------------------------------------------------

const FULLSTACK_KEYWORDS = [
  'nextjs',
  'next.js',
  'fullstack',
  'full-stack',
  'api',
  'database',
  'backend',
  '后端',
  '全栈',
  '数据库',
  '服务器',
  '登录',
  '注册',
  '认证',
  'crud',
  'ai',
  '智能',
  'agent',
  '助手',
  '客服',
  '问答',
  '聊天机器人',
  '文案生成',
  '内容创作',
  '数据分析',
  '智能推荐',
  '翻译',
  '摘要',
  '对话',
  'llm',
];

const COMPLEX_KEYWORDS = [
  'react',
  'typescript',
  'tailwind',
  'component',
  'state',
  'todo',
  'app',
  '组件',
  '交互',
  '状态管理',
];

const SIMPLE_KEYWORDS = [
  'hello world',
  'simple',
  'static',
  'html',
  'basic',
  '简单',
  '静态',
  '展示',
];

/** 按优先级排列的匹配规则 */
const MATCH_RULES: Array<{ keywords: string[]; type: TemplateMetadata['type'] }> = [
  { keywords: FULLSTACK_KEYWORDS, type: 'fullstack' },
  { keywords: COMPLEX_KEYWORDS, type: 'complex' },
  { keywords: SIMPLE_KEYWORDS, type: 'simple' },
];

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 列出用户可选模板
 */
export function listTemplates(): TemplateMetadata[] {
  return BUILTIN_TEMPLATES.filter((t) => !TEMPLATE_IDS_EXCLUDED_FROM_USER_SELECTION.has(t.id));
}

/**
 * 通过 ID 获取模板元数据（含不对用户展示的模板）
 */
export function getTemplateById(templateId: string): TemplateMetadata | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === templateId) ?? null;
}

/**
 * 根据关键词匹配模板
 *
 * 匹配优先级：fullstack > complex > simple，无匹配时默认 simple。
 */
export function matchTemplate(userInput: string): TemplateMetadata | null {
  const lowerInput = userInput.toLowerCase();

  for (const rule of MATCH_RULES) {
    if (rule.keywords.some((kw) => lowerInput.includes(kw))) {
      return findByType(rule.type);
    }
  }

  return findByType('simple');
}
