import type { ReactNode } from 'react';
import type { MessageRole } from '../types.js';

export interface MessageBubbleProps {
  role: MessageRole;
  children: ReactNode;
  className?: string;
}

export function MessageBubble({ role, children, className = '' }: MessageBubbleProps) {
  const isUser = role === 'user';
  const baseClass = 'rounded-lg px-4 py-3 max-w-[80%]';
  const roleClass = isUser
    ? 'ml-auto bg-blue-600 text-white'
    : 'mr-auto bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100';

  return <div className={`${baseClass} ${roleClass} ${className}`}>{children}</div>;
}
