# Task / Chat / Run Specification

基于 `rush-app v2` 的生产经验，结合 Lux 现有 `run_events + checkpoint + SSE②` 架构，对“同一个任务可开启多个聊天窗口、且支持断流恢复”的正式设计。

## 背景

当前 `apps/web/app/api/chat/route.ts` 仍是 Web 直连模型的临时路径，聊天窗口与执行链路没有彻底收敛：

- `conversation` 目前既承担 UI 对话窗口，又隐含承担长期上下文
- `chat` 直连流没有进入 `run` / `checkpoint` / `run_events` 主链路
- 页面级断流恢复依赖简化版 `use-stream-heartbeat`，与 `rush-app v2` 的服务端判定模式不等价

产品新约束：

- 一个真实任务可能很长，用户需要随时新开一个 chat window 继续同一任务
- 同一个任务下允许存在多个 conversation
- 同一个任务同一时刻只允许一个 active run

## 目标

1. 让 `task` 成为长期任务上下文单位
2. 让 `conversation` 成为单个 chat window
3. 让每次用户发送消息都落成一个 `run`
4. 让 follow-up 恢复复用现有 `parentRunId + checkpoint` 机制
5. 让断流恢复主路径对齐 Lux 现有 `run_events + Last-Event-ID`
6. 让新 chat 不复制旧 transcript，而是从任务上下文继续

## 非目标

- 第一版不支持同一个 task 并发多个 active run
- 第一版不以 `activeStreamId` 作为断流恢复主锚点
- 第一版不要求多个窗口同时消费同一条实时 token 流
- 第一版不保留 `apps/web/app/api/chat/route.ts` 作为正式主执行路径

## 核心决策

### 1. 三层模型

- **Task**: 长期任务上下文单位，可拥有多个 conversation
- **Conversation**: 单个聊天窗口，只承载本窗口 transcript 与展示状态
- **Run**: 一次实际执行，负责流式输出、事件持久化、checkpoint、恢复

### 2. 断流恢复主锚点

主锚点采用：

- `runId`
- `run_events.seq`
- 浏览器 `Last-Event-ID`

恢复主路径采用：

- `GET /api/runs/[id]/stream`

不采用以下方案作为第一版主锚点：

- `conversationId`
- `/api/chat/[conversationId]/stream`
- `activeStreamId` 单独驱动的 heart/resume 协议

原因：

- `specs/web-api.md` 已定义 SSE② 主路径为 `run_events + Last-Event-ID`
- `specs/recovery.md` 已定义 follow-up 恢复基于 `parentRunId + checkpoint`
- `activeStreamId` 当前仅作为 StreamRegistry 加速预留字段，MVP 尚未成为权威真相源

### 3. 单 Task 单 Active Run

同一个 task 在任意时刻最多只允许一个 active run。

约束行为：

- 若 `task.activeRunId` 非空，创建新 run 返回冲突
- 冲突响应建议使用 `409 CONFLICT`
- 返回体包含当前 `activeRunId`

这样可避免：

- 同一任务链并发推进 `headRunId`
- 同一 workspace / checkpoint 链并发写
- 多窗口、多 chat 同时驱动同一任务造成状态分叉

### 4. 任务链锚点

`task.headRunId` 的定义必须严格为：

- 最近一个已成功产出可恢复 checkpoint 的 run

不允许把以下 run 写入 `headRunId`：

- 仍在运行的 run
- 尚未完成 finalization 的 run
- 未写出 checkpoint 的 run
- failed / cancelled run

新 run 的 follow-up 恢复规则：

- `parentRunId = task.headRunId`
- 若 `task.headRunId` 为空，则该 run 为 initial run
- 若 parent checkpoint 恢复失败，按现有 `specs/recovery.md` 降级为 initial run

### 5. 消息真相源

第一版采用双层真相：

- **in-flight 真相源**: `run_events`
- **会话读模型**: `messages`

原则：

- 流式进行中，前端展示以 `run_events` 派生结果为准
- run 完成后，再物化到 `messages`
- `messages` 不再作为进行中流的权威状态来源

## 数据模型

### 新增 `tasks`

建议字段：

```ts
tasks
- id: uuid pk
- project_id: uuid fk -> projects.id
- agent_id: uuid fk -> agents.id
- created_by: uuid fk -> users.id
- title: text
- status: varchar
- handoff_summary: text | jsonb
- head_run_id: uuid fk -> runs.id nullable
- active_run_id: uuid fk -> runs.id nullable
- created_at
- updated_at
```

建议索引：

- `(project_id, updated_at desc)`
- `(active_run_id)`
- `(head_run_id)`

`task.agent_id` 语义：

- 表示该 task 的默认执行 agent
- Task chat mode 下，若 `POST /api/runs` 未显式传 `agentId`，则默认使用 `task.agent_id`
- 若显式传了 `agentId`，第一版必须与 `task.agent_id` 相同
- 第一版不支持在同一 task 执行链中途切换 agent
- 后续如需支持 agent handoff，再单独扩展 spec

### 扩展 `conversations`

新增：

```ts
conversations
- task_id: uuid fk -> tasks.id
```

保留：

- `projectId`
- `agentId`
- `userId`
- `title`
- `summary`
- `metadata`

语义变化：

- `conversation` 不再是长期恢复锚点
- `conversation.summary` 是窗口级摘要
- 任务级长期交接摘要放到 `task.handoffSummary`

### 扩展 `runs`

新增：

```ts
runs
- task_id: uuid fk -> tasks.id
- conversation_id: uuid fk -> conversations.id
```

保留：

- `parentRunId`
- `activeStreamId`
- `status`
- `prompt`

语义变化：

- 每次用户发送消息都创建一个新的 run
- run 必须显式归属 task 与 conversation

## API 设计

### Task API

新增：

- `POST /api/tasks`
- `GET /api/tasks`
- `GET /api/tasks/[id]`
- `POST /api/tasks/[id]/conversations`
- `GET /api/tasks/[id]/conversations`

### Run API

扩展：

- `POST /api/runs`

合同演进规则：

- 旧的 `CreateRunRequest` / `RunSpec` 仅覆盖 project 级 run
- 引入 task-chat-run 后，`POST /api/runs` 分为两类调用模式：
  - **Task chat mode**: 必须传 `taskId + conversationId`
  - **Legacy project mode**: 仅传 `projectId`，用于现有非 chat 场景
- 第一版保持同一路由兼容两种模式，但 contracts 中必须显式区分两种请求体
- chat 页面与 task 页面一律只使用 Task chat mode

新请求体语义：

```json
{
  "prompt": "Continue building auth",
  "projectId": "uuid",
  "taskId": "uuid",
  "conversationId": "uuid",
  "agentId": "uuid"
}
```

Task chat mode 额外约束：

- `taskId` 必填
- `conversationId` 必填
- `conversation.projectId` 必须等于 `task.projectId`
- `conversation.taskId` 必须等于 `taskId`

流程变更：

1. 验证 task / conversation / project 归属一致
2. 检查 `task.activeRunId`
3. 若存在 active run，返回 `409`
4. 创建 run，写入 `taskId + conversationId + parentRunId`
5. 设置 `task.activeRunId = run.id`
6. 入队执行

### Stream API

保留并强化：

- `GET /api/runs/[id]/stream`

作为唯一正式流式主路径：

- 浏览器实时消费 run 输出
- 断线重连依赖 `Last-Event-ID`
- 服务端从 `run_events` 补发

### 兼容 API

阶段性保留但降级为兼容层：

- `POST /api/chat/start`
- `POST /api/conversations`

阶段性保留但不再承担正式执行：

- `POST /api/chat`

目标状态：

- 新入口统一走 `task + conversation + run`
- `POST /api/chat` 仅保留为过渡期 fallback，最终下线

## 前端交互

### Home Page

当前首页“开始聊天”行为：

- 现状：`/api/chat/start` 创建一个 conversation 后直接进入 chat
- 目标：创建一个 task + 首个 conversation，然后进入 chat

### Chat Page

当前主路径：

- `useChat`
- `DefaultChatTransport({ api: '/api/chat' })`

目标主路径：

1. 发送消息 -> `POST /api/runs`
2. 拿到 `runId`
3. 订阅 `GET /api/runs/[runId]/stream`
4. 用 `run_events` 派生当前 assistant 输出
5. run 完成后同步/刷新 `messages`

### New Chat in Task

新增交互：

- 在 task 详情或 chat 页提供 “New Chat in Task”

行为：

1. 创建新的 `conversation(taskId=当前 task)`
2. 不复制旧 transcript
3. 展示 task 标题、handoff summary、当前状态
4. 用户第一条消息发送时新建 run

### 多窗口

第一版支持：

- 多窗口打开同一 task 的不同 conversation
- 多窗口打开同一 conversation

第一版不保证：

- 多窗口同时消费同一条 token 级实时流

保证的行为：

- 刷新 / 断线后可通过 `runId + Last-Event-ID` 恢复
- 多窗口可观察到同一 task 的 active run 状态
- 任意窗口发起第二个 run 会命中单 active run 约束

## 状态推进规则

### 创建 run 前

- 校验 `task.activeRunId == null`
- 读取 `task.headRunId`
- 计算 `parentRunId`

### run 进入运行

- 设置 `task.activeRunId = run.id`

### run 完成

在以下条件全部满足后推进 `headRunId`：

- run 到达可完成终态
- checkpoint 创建成功
- 该 run 仍是 task 当前 active run

推进动作：

1. `task.headRunId = run.id`
2. `task.activeRunId = null`

实现约束：

- `headRunId` 推进与 `activeRunId` 清理必须由同一个完成回调负责
- 不允许由前端或独立补偿逻辑抢先清空 `activeRunId`
- 若 checkpoint 未成功写出，则该 run 不得推进 `headRunId`

### run 失败 / 取消

动作：

1. 清空 `task.activeRunId`
2. 不更新 `task.headRunId`

## Handoff Summary

为解决“上下文太长，新 chat 效果变差”的问题，task 需要长期摘要。

`task.handoffSummary` 建议包含：

- 当前任务目标
- 已完成事项
- 关键决策
- 关键文件
- 未完成 TODO
- 下一步建议

用法：

- 新 conversation 首次发送消息时，优先注入 handoff summary
- handoff summary 与 parent checkpoint 共同构成恢复上下文
- 不直接复制旧 conversation 的完整 transcript

组合顺序：

1. `task.handoffSummary`
2. `parentRunId` 对应 checkpoint 恢复结果
3. 当前用户输入 prompt

设计约束：

- handoff summary 用于压缩长期任务语义
- checkpoint 用于恢复最近一次可继续执行的技术上下文
- 第一版不要求把旧 conversation transcript 重新拼回 prompt

## Messages 物化策略

第一版采用延迟物化：

- 运行中：UI 从 `run_events` 派生 assistant 输出
- 运行完成：把本次 run 对应的人类可读消息物化到 `messages`
- 历史查看：默认从 `messages` 读取，必要时可回退到 `run_events` 重建

设计约束：

- 不允许在运行中用浏览器端 auto-save 覆盖服务端的最终 assistant transcript
- `messages` 是会话读模型，不是运行中流的真相源
- 若过渡期仍保留客户端 auto-save，必须限制为草稿/非权威写入

## 迁移计划

### Phase 1

- 新增 `tasks`
- `conversations.taskId`
- `runs.taskId`
- `runs.conversationId`
- 新增 TaskService / TaskDb

存量数据回填规则：

- 为每个已有 `conversation` 创建一个默认 `task`
- `task.projectId = conversation.projectId`
- `task.agentId = conversation.agentId`
- `task.title` 初始取 `conversation.title ?? 'Untitled Task'`
- 迁移期允许历史 conversation 的 `taskId` 先批量回填后再改为非空约束
- 若无法安全确定历史 `headRunId`，则置空；后续首次新 run 走 initial run

### Phase 2

- 扩展 `POST /api/runs`
- 增加 task 互斥逻辑
- 正式让 chat send 走 run 主链路

### Phase 3

- Chat UI 改为订阅 `/api/runs/[id]/stream`
- 新增 “New Chat in Task”
- 首页入口改为创建 task + 首个 conversation

### Phase 4

- 物化 `messages` 读模型
- 生成 / 更新 `task.handoffSummary`
- 清理旧 `/api/chat` 直连主路径

## 测试要点

### Schema / Service

- [ ] tasks schema 正确
- [ ] conversations.taskId 外键正确
- [ ] runs.taskId / conversationId 外键正确
- [ ] 单 task 单 active run 互斥
- [ ] `headRunId` 只在 checkpoint 成功后推进

### API

- [ ] `POST /api/tasks` 正常创建
- [ ] `POST /api/tasks/[id]/conversations` 创建新 chat
- [ ] `POST /api/runs` 绑定 taskId + conversationId
- [ ] active run 存在时 `POST /api/runs` 返回 409

### Recovery

- [ ] `GET /api/runs/[id]/stream` 正常输出 SSE
- [ ] `Last-Event-ID` 跳过已发事件
- [ ] 非数字 `Last-Event-ID` 返回 DONE
- [ ] 刷新页面后能恢复 active run 输出

### UX / E2E

- [ ] 创建任务 -> 首个 conversation -> 发起 run
- [ ] 同一 task 新开第二个 conversation
- [ ] 第二个 conversation 发送 follow-up run，继承 `headRunId`
- [ ] 同一 task 并发发送第二个 run 被拒绝

## 与现有 Spec 的关系

- `specs/web-api.md`
  - 保留 `GET /api/runs/[id]/stream` 为 SSE② 主路径
  - 后续扩展 `POST /api/runs` 请求体和流程
  - 需要同步修正旧文档中与当前实现已不一致的 agent 解析与队列命名描述

- `specs/recovery.md`
  - 保留 `parentRunId + checkpoint` 恢复模型
  - `task.headRunId` 仅决定 follow-up run 的 parent

- `specs/stream.md`
  - 保留 `activeStreamId + StreamRegistry` 作为后续优化能力
  - 不改变第一版的权威恢复主路径
