/**
 * 工作区路径管理
 *
 * 路径约定：
 * - 沙箱容器内：/home/user/workspace/
 * - 本地开发：项目根目录同级的 workspace/（如 /Users/cy/www/github/workspace/）
 *
 * 可通过环境变量 WORKSPACE_PATH 覆盖。
 * 每个项目在 workspace/{projectId}/ 下。
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 沙箱容器内的默认路径 */
const SANDBOX_WORKSPACE_PATH = '/home/user/workspace';

/**
 * 从 startDir 向上查找 monorepo 根目录（包含 pnpm-workspace.yaml 或 turbo.json）
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = startDir;
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(currentDir, 'pnpm-workspace.yaml')) ||
      existsSync(join(currentDir, 'turbo.json'))
    ) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return dirname(process.cwd());
}

function resolveDefaultWorkspacePath(): string {
  // In sandbox (Linux container), /home/user exists — use the container path.
  // On macOS / local dev, use project root's sibling directory.
  if (existsSync(dirname(SANDBOX_WORKSPACE_PATH))) {
    return SANDBOX_WORKSPACE_PATH;
  }
  const projectRoot = findProjectRoot();
  return join(dirname(projectRoot), 'workspace');
}

let initializedWorkspacePath: string | null = null;

/**
 * 获取工作区根路径
 *
 * 优先级：
 * 1. 环境变量 WORKSPACE_PATH
 * 2. /home/user/workspace（沙箱）
 * 3. {monorepo根目录}/../workspace（本地开发）
 *
 * 首次调用时创建目录，后续直接返回缓存。
 */
export function getWorkspacePath(): string {
  const workspacePath = process.env.WORKSPACE_PATH ?? resolveDefaultWorkspacePath();

  if (initializedWorkspacePath !== workspacePath) {
    mkdirSync(workspacePath, { recursive: true });
    initializedWorkspacePath = workspacePath;
  }

  return workspacePath;
}

/** 重置缓存（仅用于测试） */
export function resetWorkspaceCache(): void {
  initializedWorkspacePath = null;
}

/**
 * 获取工作区路径（末尾带斜杠）
 */
export function getWorkspacePathWithSlash(): string {
  return `${getWorkspacePath()}/`;
}

/**
 * 获取项目路径
 */
export function getProjectPath(projectId: string): string {
  return join(getWorkspacePath(), projectId);
}

/**
 * 确保项目目录存在
 */
export function ensureProjectDir(projectId: string): string {
  validateProjectId(projectId);
  const projectPath = getProjectPath(projectId);
  mkdirSync(projectPath, { recursive: true });
  return projectPath;
}

/**
 * 校验 projectId 格式，防止路径遍历
 */
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;

export function validateProjectId(projectId: string): void {
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      `[Workspace] Invalid projectId: "${projectId}". Only alphanumeric, underscore, hyphen, and dot are allowed.`
    );
  }
}

/**
 * 检查路径是否在工作区内
 */
export function isPathInWorkspace(path: string): boolean {
  const workspacePath = getWorkspacePath();
  const normalizedPath = path.toLowerCase();
  const normalizedWorkspace = workspacePath.toLowerCase();

  if (!normalizedPath.startsWith(normalizedWorkspace)) {
    return false;
  }
  if (normalizedPath.length === normalizedWorkspace.length) {
    return true;
  }
  return normalizedPath[normalizedWorkspace.length] === '/';
}
