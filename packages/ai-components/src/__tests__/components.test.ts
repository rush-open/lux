import { describe, expect, it } from 'vitest';
import type { ChatMessage, MessageContent, MessageRole, ToolCall } from '../types.js';

describe('AI Component Types', () => {
  it('MessageRole includes user/assistant/system', () => {
    const roles: MessageRole[] = ['user', 'assistant', 'system'];
    expect(roles).toHaveLength(3);
  });

  it('MessageContent supports text type', () => {
    const content: MessageContent = { type: 'text', text: 'Hello world' };
    expect(content.type).toBe('text');
    expect(content.text).toBe('Hello world');
  });

  it('MessageContent supports code type', () => {
    const content: MessageContent = {
      type: 'code',
      text: 'console.log("hi")',
      language: 'javascript',
    };
    expect(content.language).toBe('javascript');
  });

  it('MessageContent supports tool_call type', () => {
    const content: MessageContent = {
      type: 'tool_call',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      input: { command: 'ls' },
    };
    expect(content.toolName).toBe('Bash');
  });

  it('ChatMessage has required fields', () => {
    const msg: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      createdAt: new Date(),
    };
    expect(msg.id).toBe('msg-1');
    expect(msg.content).toHaveLength(1);
  });

  it('ToolCall tracks execution status', () => {
    const call: ToolCall = {
      id: 'tc-1',
      name: 'Read',
      input: { path: '/tmp/file.ts' },
      status: 'completed',
      output: 'file contents',
    };
    expect(call.status).toBe('completed');
    expect(call.output).toBe('file contents');
  });
});

describe('Component exports', () => {
  it('exports MessageBubble', async () => {
    const mod = await import('../message/message-bubble.js');
    expect(mod.MessageBubble).toBeDefined();
  });

  it('exports MessageList', async () => {
    const mod = await import('../message/message-list.js');
    expect(mod.MessageList).toBeDefined();
  });

  it('exports CodeBlock', async () => {
    const mod = await import('../code/code-block.js');
    expect(mod.CodeBlock).toBeDefined();
  });

  it('exports PromptInput', async () => {
    const mod = await import('../input/prompt-input.js');
    expect(mod.PromptInput).toBeDefined();
  });

  it('exports ChatView', async () => {
    const mod = await import('../layout/chat-view.js');
    expect(mod.ChatView).toBeDefined();
  });
});
