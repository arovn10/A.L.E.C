import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import RagBadge from './RagBadge';

function markdownToHtml(text) {
  // Escape HTML special chars first to prevent injection
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code: `code`
    .replace(/`([^`]+)`/g, '<code class="bg-gray-700 px-1 rounded text-sm font-mono">$1</code>')
    // Bare URLs
    .replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-purple-400 hover:text-purple-300">$1</a>'
    )
    // Newlines to <br>
    .replace(/\n/g, '<br>');
}

function AssistantContent({ content }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      // SAFE: DOMPurify sanitizes all HTML before assignment
      const safe = DOMPurify.sanitize(markdownToHtml(content));
      ref.current.innerHTML = safe;
    }
  }, [content]);

  return <div ref={ref} className="prose-sm text-sm leading-relaxed" />;
}

export default function MessageBubble({ role, content, timestamp }) {
  const isUser = role === 'user';
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  if (isUser) {
    return (
      <div className="flex justify-end mb-3 px-4">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 bg-purple-900/40 text-white text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
          {timeStr && (
            <p className="text-right text-xs text-gray-500 mt-1 pr-1">{timeStr}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-3 px-4">
      <div className="max-w-[75%]">
        <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-gray-800 text-gray-100">
          <AssistantContent content={content} />
          <RagBadge content={content} />
        </div>
        {timeStr && (
          <p className="text-left text-xs text-gray-500 mt-1 pl-1">{timeStr}</p>
        )}
      </div>
    </div>
  );
}
