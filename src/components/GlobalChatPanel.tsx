import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { ChatMessage } from '../../shared/puzzle';

interface GlobalChatPanelProps {
  messages: ChatMessage[];
  currentHandle: string;
  onlineCount: number;
  connected: boolean;
  onSendMessage: (text: string) => void;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const GlobalChatPanel: React.FC<GlobalChatPanelProps> = ({
  messages,
  currentHandle,
  onlineCount,
  connected,
  onSendMessage,
}) => {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !connected) return;
    onSendMessage(trimmed);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full min-h-[340px]">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-900">Global Chat</span>
        <span className="text-xs text-slate-500 font-mono tabular-nums">
          {connected ? `${onlineCount} online` : 'Reconnecting...'}
        </span>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto py-3 space-y-2.5 max-h-[380px] pr-1"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">
            No messages yet. Say hello to start the conversation.
          </p>
        ) : (
          messages.map((msg) => {
            if (msg.kind === 'system') {
              return (
                <div
                  key={msg.id}
                  className="text-xs text-blue-700 bg-blue-50/70 rounded-lg px-3 py-2 border border-blue-100"
                >
                  <span className="font-medium">{msg.text}</span>
                  <span className="text-blue-400 ml-2 font-mono">{formatClock(msg.createdAt)}</span>
                </div>
              );
            }

            const isSelf = msg.handle.toLowerCase() === currentHandle.toLowerCase();
            return (
              <div key={msg.id} className="text-sm leading-snug">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      isSelf ? 'text-blue-600' : 'text-slate-800'
                    }`}
                  >
                    {msg.handle}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {formatClock(msg.createdAt)}
                  </span>
                </div>
                <p className="text-slate-700 text-[13px] mt-0.5 break-words">{msg.text}</p>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="pt-3 border-t border-slate-200 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={240}
          placeholder={connected ? `Message as ${currentHandle}...` : 'Connecting to chat...'}
          disabled={!connected}
          className="flex-1 min-w-0 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          aria-label="Send message"
          className="inline-flex items-center justify-center px-3.5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
