export default function ReviewCard({ item, onApprove, onReject }) {
  const score = item?.qualityScore ?? null;

  function scoreBadgeClass(s) {
    if (s === null) return 'bg-gray-600 text-gray-200';
    if (s >= 0.75) return 'bg-green-600 text-white';
    if (s >= 0.40) return 'bg-amber-500 text-white';
    return 'bg-red-600 text-white';
  }

  return (
    <div className="bg-alec-800 border border-white/10 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono">{item.id}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scoreBadgeClass(score)}`}>
          {score !== null ? `Quality: ${score.toFixed(2)}` : 'Quality: --'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">User</span>
          <div className="bg-alec-700 rounded p-3 text-sm text-gray-100 whitespace-pre-wrap break-words">
            {item.userMessage ?? '--'}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">ALEC</span>
          <div className="bg-alec-900 rounded p-3 text-sm text-gray-100 whitespace-pre-wrap break-words">
            {item.alecResponse ?? '--'}
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onReject(item.id)}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
        >
          <span>&#10007;</span> Reject
        </button>
        <button
          onClick={() => onApprove(item.id)}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
        >
          <span>&#10003;</span> Approve
        </button>
      </div>
    </div>
  );
}
