import { useRef, useEffect, useState, useCallback } from 'react';
import { useChatStore } from '../../store/chatStore';
import { streamMessage } from '../../api/chat';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';

export default function ChatPanel() {
  const { messages, sessionId, isStreaming, addMessage, updateLastAssistant, setStreaming, clearSession } =
    useChatStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const cleanupRef = useRef(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const cancelStream = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setStreaming(false);
  }, [setStreaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');

    addMessage({ role: 'user', content: text, timestamp: Date.now() });
    addMessage({ role: 'assistant', content: '', timestamp: Date.now() });
    setStreaming(true);

    const cleanup = streamMessage(
      text,
      sessionId,
      (token) => updateLastAssistant(token),
      () => {
        setStreaming(false);
        cleanupRef.current = null;
      },
      (err) => {
        console.error('Stream error:', err);
        setStreaming(false);
        cleanupRef.current = null;
      }
    );
    cleanupRef.current = cleanup;
  }, [input, isStreaming, sessionId, addMessage, updateLastAssistant, setStreaming]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const lastMessage = messages[messages.length - 1];
  const showTypingIndicator = isStreaming && lastMessage?.role === 'assistant' && lastMessage?.content === '';

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
        <h2 className="text-sm font-semibold text-gray-300">A.L.E.C. Chat</h2>
        <button
          onClick={clearSession}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Clear session
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            Send a message to start
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} timestamp={msg.timestamp} />
        ))}
        {showTypingIndicator && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-700/50 px-4 py-3">
        {isStreaming && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={cancelStream}
              className="text-xs px-3 py-1 rounded-full bg-red-900/40 text-red-300 hover:bg-red-900/70 transition-colors border border-red-700/40"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder="Ask A.L.E.C. anything… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 resize-none bg-gray-800 text-white text-sm rounded-xl px-4 py-2.5 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-600/50 disabled:opacity-50 min-h-[42px] max-h-40 overflow-y-auto"
            style={{ fieldSizing: 'content' }}
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="flex-shrink-0 px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
