import type { ReactNode } from 'react';

export interface ChatViewProps {
  header?: ReactNode;
  messages: ReactNode;
  input: ReactNode;
  className?: string;
}

export function ChatView({ header, messages, input, className = '' }: ChatViewProps) {
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {header && (
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700">{header}</div>
      )}
      <div className="flex-1 overflow-y-auto">{messages}</div>
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-4">{input}</div>
    </div>
  );
}
