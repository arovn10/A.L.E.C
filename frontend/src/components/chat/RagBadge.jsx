export default function RagBadge({ content }) {
  if (!content || !content.includes('[RAG:')) return null;
  return (
    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-900/50 text-purple-300 border border-purple-700/40">
      📚 RAG sources
    </span>
  );
}
