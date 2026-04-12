export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageContent {
  type: 'text' | 'code' | 'tool_call' | 'tool_result' | 'error' | 'image';
  text?: string;
  language?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: string;
  errorText?: string;
  src?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: MessageContent[];
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}
