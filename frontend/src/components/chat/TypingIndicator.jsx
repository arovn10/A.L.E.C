export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <span
        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}
