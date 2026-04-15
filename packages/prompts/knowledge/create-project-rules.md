# 项目创建规范

---

## 📋 复杂项目规划（Planning with Files）

**🔴 重要：当用户请求满足以下任一条件时，必须在开始任何实现之前先执行规划流程：**

| 触发条件 | 示例 |
|---------|------|
| 多步骤任务（3+ 步骤） | "创建一个带登录、注册、个人中心的应用" |
| 涉及多个功能模块 | "做一个电商网站，有商品列表、购物车、结算" |
| 涉及 API + 前端 | "创建一个笔记应用，有 CRUD API 和前端界面" |
| 需要研究或探索 | "帮我实现一个拖拽排序功能" |
| 预计 >5 次工具调用 | 复杂 UI、多组件、多文件修改 |
| 用户描述模糊需要澄清 | "帮我做一个漂亮的首页" |

### 🔴 强制执行流程（必须按顺序执行，不可跳过）

**第一步：创建规划目录和文件**
在项目的 `.planning/` 目录下创建以下文件：
- `task_plan.md` - 任务分解和进度追踪
- `findings.md` - 研究发现和技术决策
- `progress.md` - 会话日志和测试结果

**第二步：填写任务计划**
将用户需求分解为清晰的阶段（Phase），每个阶段标记状态：
- `pending` - 待开始
- `in_progress` - 进行中
- `complete` - 已完成

**第三步：开始实现**
只有在完成上述规划步骤后，才能开始实际的代码实现。

### ❌ 禁止行为

- ❌ **禁止跳过规划直接开始编码**（复杂任务必须先规划）
- ❌ **禁止仅口头说"我会创建规划"而不实际创建文件**

### ✅ 简单任务无需规划

以下情况可以跳过规划，直接开始：
- 单文件修改
- 简单样式调整
- 快速问答
- 单一功能的小改动

---

## 🚀 项目创建优先级顺序（必须严格遵守）

### 【首选】使用模板 API 创建（推荐，速度快 3-4 倍）

| 模板 ID | 适用场景 | 技术栈 |
|---------|---------|--------|
| **simple-html** | Hello World、纯展示、静态页面、无交互 | HTML + CSS + Vite |
| **react-tailwind-v3** | 组件化、交互功能、状态管理、前端应用 | React + TypeScript + Tailwind |
| **nextjs-fullstack** | API、数据库、SSR/SSG、用户认证、全栈、AI 能力 | Next.js + TypeScript |

🔴 **判断优先级**：后端功能/AI 能力 > 前端复杂度

**后端功能 / AI 能力关键词**（必须使用 nextjs-fullstack）：
后端、API、数据库、服务器、全栈、用户管理、登录、注册、认证、数据存储、CRUD、AI、智能、Agent、助手、客服、问答、聊天机器人、文案生成、内容创作、数据分析、自动分析、智能推荐、翻译、摘要、对话、LLM

**调用方式**：
```bash
curl -X POST ${podApiBaseUrl}/api/templates/scaffold \
  -H "Content-Type: application/json" \
  -d '{"templateId": "模板ID", "projectId": "${projectId}", "projectName": "项目名称", "workspacePath": "${workspacePath}"}'
```

> **注意**：`workspacePath` 参数确保项目创建在正确的目录中，特别是在测试环境下。

### 🔴 模板创建成功后的标准流程（必须严格遵守）

**模板已包含完整配置，无需验证！直接执行以下步骤：**

**⚠️ 重要：每个步骤必须单独执行一个 Bash 命令，禁止合并多个命令！**

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `cd ${workspacePath}${projectId} && pnpm install` | 进入目录并安装依赖 |
| 2 | `nohup pnpm run dev > dev-server.log 2>&1 &` | 启动开发服务器（端口冲突会自动失败） |
| 3 | `sleep 3 && curl -I http://localhost:8000` | 等待并验证服务 |

**⚠️ 如果步骤 2 失败（端口被占用）**：
| 步骤 | 命令 | 说明 |
|------|------|------|
| 2a | `(ss -tlnp \| grep :8000 \| grep -oP 'pid=\K\d+' \| xargs -r kill -9 2>/dev/null &) ; sleep 0.5` | 清理端口（后台执行，避免流式中断） |
| 2b | `nohup pnpm run dev > dev-server.log 2>&1 &` | 重新启动 |
| 2c | `sleep 3 && curl -I http://localhost:8000` | 验证服务 |

**🔴 关于端口清理的重要说明**：
- 使用 `(... &) ; sleep 0.5` 后台执行 kill，避免流式响应中断
- 线上环境使用 `ss` 命令，本地 macOS 可用 `lsof`

**🔴 禁止的做法：**
- ❌ 把多个步骤合并成一个命令（会导致 shell 解析错误）
- ❌ 使用 `\n` 连接多个命令

**🔴 禁止的冗余操作（模板已预配置）：**
- ❌ 验证 `package.json` 位置（模板已放置正确）
- ❌ 读取/检查 `vite.config.ts` 配置（模板已包含 `host: true` 和 `allowedHosts: true`）
- ❌ 检查 Git 初始化（模板已初始化）

**模板保证：**
- ✅ `vite.config.ts` 已包含 `server: { host: true, allowedHosts: true }`
- ✅ `package.json` 已在正确位置
- ✅ Git 已初始化
- ✅ 所有依赖已在 `dependencies` 和 `devDependencies` 中声明

### 🔴 修改模板文件规范（必须遵守）

**写入文件前必须先读取！**

模板创建后需要修改文件（如 `App.tsx`）时，必须先使用 `Read` 工具读取文件内容，然后再使用 `Write` 工具写入。

```
❌ 错误流程：直接 Write App.tsx → 报错 "File has not been read yet"
✅ 正确流程：Read App.tsx → Write App.tsx
```

**原因**：系统要求在写入文件前必须先读取，以确保了解文件当前状态。

### 【备选】手动创建

仅在以下情况使用：
- 模板 API 调用失败
- 用户明确要求自定义配置

---

## 🔴 Next.js 15 App Router 关键约定（nextjs-fullstack 模板必读）

使用 `nextjs-fullstack` 模板时，**必须遵循 Next.js 15 的异步 API 约定**，否则 `pnpm build` 会报类型错误。

### 动态路由 params 是异步的（必须 await）

```typescript
// ✅ 正确：Next.js 15 写法（params 是 Promise）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ...
}

// ❌ 错误：Next.js 14 旧写法（会导致 build 失败）
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
}
```

### 其他异步 API

| API | Next.js 15 用法 | 旧写法（❌ 错误） |
|-----|----------------|-----------------|
| `params` | `const { id } = await params` | `const { id } = params` |
| `searchParams` | `const q = (await searchParams).q` | `const q = searchParams.q` |
| `cookies()` | `const c = await cookies()` | `const c = cookies()` |
| `headers()` | `const h = await headers()` | `const h = headers()` |

### 动态路由文件示例（app/api/notes/[id]/route.ts）

```typescript
import { NextResponse } from 'next/server';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  // ... 业务逻辑
  return NextResponse.json({ id, ...body });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ... 删除逻辑
  return NextResponse.json({ success: true });
}
```

🔴 **每个使用动态路由参数 `[id]`、`[slug]` 等的 API 路由和页面组件都必须使用 `Promise` 类型并 `await`。**

---

## ⚠️ 手动创建时的路径规范（必须严格遵守）

**项目必须直接创建在 `${workspacePath}${projectId}/` 目录下，不能创建嵌套子目录！**

#### ✅ 正确方式
```bash
cd ${workspacePath}${projectId}
pnpm create vite@latest . --template react-ts  # 使用 . 作为项目名称
```

#### ❌ 错误方式
```bash
pnpm create vite@latest my-app --template react-ts  # 会创建嵌套子目录
```

**验证**：`package.json` 必须在 `${workspacePath}${projectId}/package.json`

---

## 手动创建指南

### 简单项目（simple-html 替代方案）

**最小文件结构**：
```
workspace/{project_id}/
├── package.json     # 只需 vite 依赖
├── index.html       # 入口文件
├── style.css        # 样式文件
└── vite.config.js   # 最小配置
```

**package.json 示例**：
```json
{
  "name": "项目名",
  "type": "module",
  "scripts": { "dev": "vite --host --port 8000" },
  "devDependencies": { "vite": "^5.0.0" }
}
```

**安装和启动**：
```bash
pnpm install  # 🔴 必须使用 pnpm
nohup pnpm run dev > dev-server.log 2>&1 &
```

### 复杂项目（react-tailwind-v3 替代方案）

**技术栈**：React + Vite + TypeScript + Tailwind CSS v3

**TypeScript 类型定义规范**：
```typescript
// src/types.ts - 正确示例
export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

// 导入时使用 type 关键字
import type { Todo } from './types';
```

⚠️ **常见错误**：
- ❌ 类型定义忘记 `export`
- ❌ 使用 `import { type Todo }` 过时语法
- ✅ 使用 `import type { Todo }` 导入

---

## ⚠️ Git 操作规范（必须严格遵守）

### 🔴 禁止主动执行 Git 提交操作

**系统会在 AI 响应完成后自动创建版本快照，严禁手动干预版本管理流程！**

#### 严格禁止的命令
- ❌ `git add` - 禁止手动添加文件到暂存区
- ❌ `git commit` - 禁止手动创建提交
- ❌ `git push` - 禁止手动推送到远程仓库

#### 禁止原因
1. **自动版本管理**：系统在每次 AI 响应完成后会自动执行以下操作：
   - 自动 `git add .` 添加所有变更
   - 自动创建 commit（包含用户 prompt 和变更摘要）
   - 自动推送到远程仓库
2. **手动 commit 会破坏版本历史**：导致版本列表混乱，无法正确回溯
3. **避免重复提交**：手动 commit 会与自动 commit 冲突

#### 允许的 Git 操作
- ✅ `git status` - 查看工作区状态
- ✅ `git log` - 查看提交历史（推荐加 `--oneline` 参数）
- ✅ `git diff` - 查看未提交的差异
- ✅ `git diff HEAD` - 查看与上次提交的差异
- ✅ `git init` - 初始化 Git 仓库（仅项目创建时，且仅当 `.git` 目录不存在时）

#### 🟡 Git 推送失败修复（例外规则）

当用户明确告知 **Git 推送（push）失败**并请求修复时，**必须完整执行修复流程直到推送成功**。

⚠️ **核心要求：修复推送失败时，必须在最后执行 `git push origin master` 确认推送成功。** 仅执行 `git pull` 而不推送是不完整的修复——虽然用户仍可查看版本和部署，但如果用户不再继续对话且沙箱重启，未推送到远程的代码变更将永久丢失。

**触发条件**（必须同时满足）：
1. 用户主动提到推送失败或发送了推送错误信息
2. 操作目的是**修复推送失败**，而非日常的代码提交

**必须执行的完整修复流程：**

1. **诊断问题**：根据错误信息判断失败原因
2. **执行修复**：根据原因选择对应操作（见下方）
3. **🔴 推送验证（必须执行）**：修复后立即执行 `git push origin master`，确认输出中包含推送成功的信息
4. **报告结果**：告知用户推送是否成功

**修复推送失败时，可以使用任何必要的 Git 操作和代码修改**，包括但不限于：
- `git pull --rebase` - 解决 non-fast-forward
- `git push origin master` - 重新推送（**修复后必须执行**）
- `git stash` / `git stash pop` - 暂存变更
- `git rebase`、`git add`、`git rebase --continue` - 解决冲突或修改提交
- `git branch -m` - 重命名分支
- 修改代码、删除大文件、修改 `.gitignore` 等

**典型修复示例（non-fast-forward）：**
```bash
git pull --rebase origin master   # 步骤1：拉取远程变更并 rebase
git push origin master            # 步骤2：必须立即推送，不能省略
```

**🔴 禁止的操作（即使是修复推送失败也不允许）：**
- ❌ `git push --force` / `git push -f` - 禁止强制推送，会丢失远程历史
- ❌ `git reset --hard` - 禁止硬重置，会丢失本地变更
- ❌ 仅执行 `git pull` 而不推送，然后告诉用户"下次会自动推送"

**修复完成后的回应话术：**
> ✅ 推送问题已修复，代码已成功同步到远程仓库。后续的版本管理仍由系统自动处理。

**如果推送仍然失败，应告知用户具体错误并继续尝试修复，而非放弃。**

#### 用户请求"保存代码"或"提交代码"时的回应

**正确回应话术：**

当用户说以下内容时：
- "保存代码"
- "提交这些修改"
- "commit 一下"
- "保存到 git"

**你应该回复：**
> ✅ 您的修改已经保存到文件系统。当我的回复完成后，系统会自动创建一个版本快照并提交到 Git。您可以在右侧的版本列表中查看历史版本。
>
> 无需手动执行 `git commit`，版本管理由系统自动处理。

**错误做法：**
- ❌ 执行 `git add .`
- ❌ 执行 `git commit -m "xxx"`
- ❌ 执行 `git push`

#### 检查清单

在执行任何 Git 操作前，先问自己：
- [ ] 这是查询操作（status/log/diff）吗？ → 如果是，可以执行
- [ ] 这是用户报告推送失败后的修复操作吗？ → 如果是，参照上方「推送失败修复」规则，可使用任何必要操作（force push / hard reset 除外）
- [ ] 这是日常的提交操作（add/commit/push）吗？ → 如果是，**绝对不能执行**
- [ ] 这是 `git init` 吗？ → 仅在项目创建时且 `.git` 不存在时才执行

---

## 通用配置规范

### 项目创建基础规范

### ⚠️ ⚠️ ⚠️ Vite 配置规范（关键配置，必须严格遵守）⚠️ ⚠️ ⚠️

**创建项目后，必须立即修改 vite.config.ts 文件，确保包含以下完整配置：**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,         // 必需：允许外部访问
    allowedHosts: true, // 必需：跳过 Host Header 检查（由 Ingress 层处理安全性）
  },
})
```

**🔴 重要说明：**
1. `server.host: true` - 允许通过网络地址访问（支持沙箱部署）
2. `server.allowedHosts: true` - 跳过 Vite 的 Host Header 检查，信任上层代理的安全防护
3. **这两个配置必须同时存在，缺少任何一个都会导致 "Blocked request" 错误**
4. **创建项目后请务必使用 Read 工具验证 vite.config.ts 是否包含这两个配置**

**架构说明：**
- 沙箱部署在容器内网，通过 Ingress/Nginx 反向代理暴露服务
- Ingress 已处理域名验证、TLS 证书、路由控制
- Vite 服务器信任上层代理，无需重复检查 Host Header
- 使用 `allowedHosts: true` 而非域名白名单，支持动态沙箱子域名

### ⚠️ ⚠️ ⚠️ Next.js 配置规范（关键配置，必须严格遵守）⚠️ ⚠️ ⚠️

**创建 Next.js 项目后，必须立即修改 next.config.ts（或 next.config.js）文件，确保包含 `allowedDevOrigins` 配置：**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.lux.example.com'],  // 必需：允许部署域名访问 HMR WebSocket
}

export default nextConfig
```

**🔴 重要说明：**
1. `allowedDevOrigins` - 允许指定 origin 访问 Next.js dev server 的 HMR WebSocket 端点（`/_next/webpack-hmr`）
2. **缺少此配置会导致部署后页面每 ~30 秒自动刷新**（HMR WebSocket 被 Next.js 拒绝 → 客户端重试超时 → 触发 full page reload → 循环）
3. **创建项目后请务必使用 Read 工具验证 next.config 是否包含 `allowedDevOrigins`**
4. 如果项目已有 `next.config.ts` 或 `next.config.js`，在现有配置中追加 `allowedDevOrigins` 字段即可，不要覆盖其他配置

**架构说明：**
- Next.js 15.3+ 引入 `allowedDevOrigins`，控制哪些 origin 可访问 dev server 的 HMR WebSocket
- 浏览器发起 WebSocket 连接时会自动携带 `Origin` 头（如 `https://xxx.lux.example.com`）
- 如果 origin 不在允许列表中，Next.js 会拒绝 WebSocket 连接
- 使用 `*.lux.example.com` 通配符匹配所有项目的部署子域名
- 与 Vite 的 `allowedHosts` 作用类似，都是为了适配沙箱 + Ingress 的反向代理部署架构

### 🔴 vite.config.ts 副作用禁令（必须严格遵守）

**`vite.config.ts` 在 dev 和 build 两种模式下都会执行。模块顶层的副作用代码会导致 `vite build` 完成后进程无法退出，直接导致线上构建超时失败。**

**❌ 禁止在 vite.config.ts 模块顶层使用：**
- `setInterval` / `setTimeout`（会阻止 Node.js 进程退出）
- `http.createServer` / `net.createServer`（会持有端口句柄）
- 任何创建持久连接、监听器、定时器的代码

**✅ 正确做法：**
- 仅在 dev 模式运行的代码（如 API middleware、速率限制、session 管理）必须放在 Vite 插件的 `configureServer` 钩子内部
- 如果确实需要顶层定时器，使用 `.unref()` 避免阻止进程退出

```typescript
// ❌ 错误：顶层 setInterval 会阻止 vite build 退出
const rateLimitMap = new Map();
setInterval(() => { rateLimitMap.clear(); }, 300000);

// ✅ 正确：放在 configureServer 内，仅 dev 模式运行
function apiMiddleware(): Plugin {
  return {
    name: 'api-middleware',
    configureServer(server) {
      const rateLimitMap = new Map();
      setInterval(() => { rateLimitMap.clear(); }, 300000);
      server.middlewares.use((req, res, next) => { /* ... */ });
    },
  };
}
```

**真实案例**：用户项目在 `vite.config.ts` 顶层放了一个每 5 分钟清理速率限制的 `setInterval`，导致 `vite build` 完成后进程永远不退出，线上构建连续 10 分钟超时失败。

### 🔴 包管理器规范（必须使用 pnpm）

**线上环境强制使用 pnpm，禁止使用 npm！**

| 命令 | 正确 ✅ | 错误 ❌ |
|------|---------|---------|
| 安装依赖 | `pnpm install` | `npm install` |
| 运行脚本 | `pnpm run dev` | `npm run dev` |
| 添加依赖 | `pnpm add xxx` | `npm install xxx` |

**原因**：
- npm 在线上环境可能只安装 `dependencies`，不安装 `devDependencies`
- 这会导致 `@vitejs/plugin-react`、`vite`、`typescript` 等开发依赖缺失
- pnpm 会正确安装所有依赖

### 开发服务器配置
- **固定端口**：8000（避免与主应用端口冲突）
- 项目创建后运行: `pnpm run dev`（端口已在 vite.config.ts 中配置）
- 如果端口 8000 被占用，自动杀掉占用该端口的进程，然后启动新服务器
- 确保服务器成功启动后明确告知用户访问地址：http://localhost:8000

### 服务器重启规则（⚠️ 核心规则 - 必须严格遵守）

#### 🔴 关键原则：服务必须保持运行状态
- **开发服务器一旦启动，必须持续运行，除非用户明确要求停止**
- **修改代码后依赖 Vite HMR 热更新，无需手动重启服务器**
- **只有在以下情况才需要重启：**
  1. 修改了 `vite.config.ts` 配置文件
  2. 修改了 `package.json` 依赖或脚本
  3. 服务器崩溃或无响应
  4. 用户明确要求重启

#### 重启操作流程（必须严格按顺序执行）
**❗重要：重启是"杀掉 + 启动"的完整操作，缺一不可！**

1. **杀掉旧进程**（🔴 推荐使用后台执行方式，避免流式中断）：
   - **线上 Linux**: `(ss -tlnp | grep :端口号 | grep -oP 'pid=\K\d+' | xargs -r kill -9 2>/dev/null &) ; sleep 0.5`
   - **本地 macOS**: `(lsof -ti:端口号 | xargs kill -9 2>/dev/null &) ; sleep 0.5`
   - ⚠️ 避免使用 `pkill -f "vite.*端口号"`（可能导致 Exit code 144 错误）
   - ✅ 后台执行 kill 可以避免流式响应中断

2. **等待 1 秒**（确保进程完全退出）：
   ```bash
   sleep 1
   ```

3. **立即重新启动**（使用相同端口，后台运行）：
   ```bash
   nohup pnpm run dev > dev-server.log 2>&1 &
   ```

4. **验证服务启动成功**（必须执行）：
   ```bash
   sleep 3 && curl -I http://localhost:原端口号 || echo "⚠️ 警告：服务启动失败！"
   ```

#### 完整重启示例（每步单独执行）

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `(ss -tlnp \| grep :8000 \| grep -oP 'pid=\K\d+' \| xargs -r kill -9 2>/dev/null &) ; sleep 0.5` | 后台杀掉端口进程 |
| 2 | `nohup pnpm run dev > dev-server.log 2>&1 &` | 后台启动服务 |
| 3 | `sleep 3 && curl -I http://localhost:8000` | 验证服务启动 |

**本地 macOS 替代命令**：`(lsof -ti:8000 | xargs kill -9 2>/dev/null &) ; sleep 0.5`

#### 禁止行为
- ❌ **禁止只杀掉进程而不重启** → 会导致 502 错误
- ❌ **禁止为了避免端口冲突而换用新端口** → 必须保持项目端口稳定
- ❌ **禁止修改普通代码文件（.tsx/.ts/.css）后重启** → 应该依赖 HMR

#### 任务完成前检查清单
在每次对话结束前，**必须检查**：
- [ ] 开发服务器是否正在运行？（执行 `curl -I http://localhost:端口号`）
- [ ] 是否有意外杀掉进程但未重启的情况？
- [ ] 如果重启过，是否验证了服务启动成功？

**如果发现服务未运行，必须立即启动后再结束对话！**

### package.json 脚本配置
- 模板已配置：`"dev": "vite --host"`
- 端口已在 `vite.config.ts` 中指定：`server: { port: 8000, host: true, allowedHosts: true }`

### 创建完成后操作

#### 🔴 使用模板创建时（推荐）

**模板已包含所有配置，只需 3 步（每步单独执行）：**

| 步骤 | 命令 |
|------|------|
| 1 | `cd ${workspacePath}${projectId} && pnpm install` |
| 2 | `nohup pnpm run dev > dev-server.log 2>&1 &` |
| 3 | `sleep 3 && curl -I http://localhost:8000` |

**如果步骤 2 因端口占用失败**：执行 `(ss -tlnp | grep :8000 | grep -oP 'pid=\K\d+' | xargs -r kill -9 2>/dev/null &) ; sleep 0.5` 清理后重试

**完成后告知用户**：项目已创建完成，访问地址：`http://localhost:8000`

#### 手动创建时（降级方案）

仅在模板 API 失败时使用，需要完整验证：

1. **验证项目路径**：确认 `package.json` 在 `workspace/{project_id}/package.json`
2. **进入目录**：`cd workspace/{project_id}`
3. **安装依赖**：`pnpm install`（🔴 禁止使用 npm）
4. **检查 Git**：如果 `.git` 不存在，执行 `git init`
5. **验证 vite.config.ts**：确保包含 `server: { host: true, allowedHosts: true }`
6. **启动服务器**：`nohup pnpm run dev > dev-server.log 2>&1 &`
7. **验证启动**：`sleep 5 && curl -I http://localhost:8000`

---

## 检查清单

### 🔴 模板创建时（简化流程）

使用模板 API 创建时，只需检查：
- [ ] 模板 API 返回成功？
- [ ] 使用 `pnpm install` 安装依赖？（禁止 npm）
- [ ] 服务器启动成功？（`curl -I http://localhost:8000` 返回 200）

**无需检查（模板已保证）**：
- ~~项目路径~~（模板放置正确）
- ~~vite.config.ts 配置~~（模板已包含）
- ~~Git 初始化~~（模板已初始化）

### 手动创建时（完整检查）

仅在模板 API 失败时使用：

**项目路径检查**：
- [ ] `package.json` 在 `workspace/{project_id}/package.json`？
- [ ] 避免嵌套子目录？

**配置检查**：
- [ ] `vite.config.ts` 包含 `server: { host: true, allowedHosts: true }`？

**依赖安装检查**：
- [ ] 使用 `pnpm install`？（🔴 禁止使用 npm）
- [ ] 依赖安装完整？（检查 `node_modules/@vitejs/plugin-react` 存在）

**服务检查**：
- [ ] 开发服务器运行在 8000 端口？
- [ ] 通过 `curl -I http://localhost:8000` 验证成功？

### Git 操作检查（通用）
- [ ] **禁止手动执行 `git add/commit/push`**
- [ ] 用户要求"保存代码"时正确回应（告知会自动创建版本）
- [ ] 只使用查询命令（status/log/diff）

---

## 常见问题排查

### 依赖安装不完整（缺少 @vitejs/plugin-react 等）

**症状**：`npm install` 只安装了少量包，`devDependencies` 未安装

**原因**：npm 在线上环境可能跳过 `devDependencies`

**解决方案**：
```bash
# 删除不完整的安装
rm -rf node_modules package-lock.json

# 使用 pnpm 重新安装（正确安装所有依赖）
pnpm install
```

### 服务器启动失败

**排查步骤（每步单独执行）**：

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `cat dev-server.log` | 查看日志 |
| 2 | `ls node_modules/@vitejs/plugin-react` | 检查依赖是否完整 |
| 3 | `rm -rf node_modules && pnpm install` | 如缺少依赖，重新安装 |
| 4 | `nohup pnpm run dev > dev-server.log 2>&1 &` | 重新启动 |

---

**核心原则**：
- 🔴 **pnpm 优先**：线上环境必须使用 pnpm，禁止 npm（npm 不安装 devDependencies）
- 🎯 **模板信任**：使用模板后无需验证配置，直接安装依赖启动服务
- ⚡ **简化流程**：模板创建只需 3 步：安装依赖 → 启动服务 → 验证
- 🚫 **禁止手动 Git 提交**：严禁执行 `git add/commit/push`，版本管理由系统自动处理（推送失败修复除外，详见 Git 操作规范）
- 📋 **规划优先**：复杂任务必须先创建 `.planning/` 目录进行规划

---

## 📦 .planning 目录说明

**`.planning/` 目录在模板重建时会被自动保留。**

当项目需要重新应用模板时，系统会自动备份并恢复 `.planning/` 目录，规划文件不会丢失。
