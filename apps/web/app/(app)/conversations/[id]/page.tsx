'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: Array<{
    toolName: string;
    input: unknown;
    output: string | null;
    error: string | null;
  }>;
  timestamp: string;
}

interface ConversationData {
  id: string;
  title: string | null;
  projectId: string;
}

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<ConversationData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) {
      const { data } = await res.json();
      setConversation(data.conversation);
      setMessages(data.messages);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!conversation) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex-1 overflow-auto p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold truncate">{conversation.title ?? 'Conversation'}</h1>
      </div>

      <div className="space-y-4">
        {messages.map((msg) => (
          <Card key={`${msg.role}-${msg.timestamp}`} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {msg.role}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(msg.timestamp).toLocaleString()}
              </span>
            </div>
            {msg.content && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
            {msg.toolCalls.length > 0 && (
              <div className="mt-2 space-y-1">
                {msg.toolCalls.map((tc) => (
                  <div key={tc.toolName} className="text-xs bg-muted rounded px-2 py-1 font-mono">
                    <span className="font-semibold">{tc.toolName}</span>
                    {tc.error && <span className="text-destructive ml-2">{tc.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}

        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No messages yet.</p>
        )}
      </div>
    </div>
  );
}
