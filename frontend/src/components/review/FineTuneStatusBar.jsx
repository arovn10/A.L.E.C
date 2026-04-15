export default function FineTuneStatusBar({ status }) {
  const evalScore = status?.evalScore ?? null;
  const lastRun = status?.lastRun ?? null;
  const modelVersion = status?.modelVersion ?? null;
  const examplesUntilNext = status?.examplesUntilNext ?? null;

  function scoreBadgeClass(score) {
    if (score === null) return 'bg-gray-600 text-gray-200';
    if (score >= 0.80) return 'bg-green-600 text-white';
    if (score >= 0.60) return 'bg-amber-500 text-white';
    return 'bg-red-600 text-white';
  }

  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-alec-800 border-b border-white/10 text-sm">
      <div className="flex items-center gap-2 text-gray-400">
        <span className="font-medium text-gray-300">Last Run:</span>
        <span>{lastRun ? new Date(lastRun).toLocaleString() : '--'}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-300">Eval Score:</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scoreBadgeClass(evalScore)}`}>
          {evalScore !== null ? evalScore.toFixed(2) : '--'}
        </span>
      </div>

      <div className="flex items-center gap-2 text-gray-400">
        <span className="font-medium text-gray-300">Active Model:</span>
        <span>{modelVersion ?? '--'}</span>
      </div>

      <div className="flex items-center gap-2 text-gray-400">
        <span className="font-medium text-gray-300">Examples Until Next Trigger:</span>
        <span>{examplesUntilNext !== null ? examplesUntilNext : '--'}</span>
      </div>
    </div>
  );
}
