# Conversation History Specification

对话持久化，用户可以回溯和搜索历史。

## 核心概念

- **Conversation**: 一次对话会话，关联 project + agent + user
- **Run**: 一次 AI 执行，对话可包含多个 Run（follow-up）
- **reconstructMessages()**: 从 run_events 重建人类可读的消息列表

## 消息重建

从 run_events 的 UIMessageChunk 事件重建：

```
text-delta → 累积文本内容
tool-input-start → 开始新工具调用
tool-input-available → 记录工具输入
tool-output-available → 记录工具输出
tool-output-error → 记录工具错误
```

输出格式: `ReconstructedMessage[]`，每条包含 role、content、toolCalls、timestamp。

## API

### GET /api/conversations?projectId=xxx

列出项目下的对话（按时间倒序）。

### POST /api/conversations

创建对话。请求: `{ projectId, agentId?, title? }`

### GET /api/conversations/[id]

获取对话详情 + 重建的完整消息列表。

### DELETE /api/conversations/[id]

删除对话。

### GET /api/runs/search?q=xxx

按 prompt 关键词搜索历史 Run。

## 测试要点

- [x] reconstructMessages: 文本累积正确
- [x] reconstructMessages: 工具调用关联正确
- [x] reconstructMessages: 工具错误处理
- [x] reconstructMessages: 多工具调用
- [x] reconstructMessages: 空事件
