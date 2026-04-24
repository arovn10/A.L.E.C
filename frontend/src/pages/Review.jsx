import { useEffect, useState } from 'react';
import { useReviewStore } from '../store/reviewStore';
import FineTuneStatusBar from '../components/review/FineTuneStatusBar';
import ReviewCard from '../components/review/ReviewCard';

export default function Review() {
  const queue = useReviewStore((s) => s.queue);
  const status = useReviewStore((s) => s.status);
  const load = useReviewStore((s) => s.load);
  const handleApprove = useReviewStore((s) => s.handleApprove);
  const handleReject = useReviewStore((s) => s.handleReject);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      <FineTuneStatusBar status={status} />

      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex items-center justify-center h-32 text-gray-400">
            Loading review queue…
          </div>
        )}

        {!loading && queue.length === 0 && (
          <div className="max-w-2xl mx-auto mt-8 rounded-xl border border-white/5 bg-alec-800 p-6 text-center">
            <div className="text-3xl mb-3">📭</div>
            <h3 className="text-base font-semibold text-white mb-2">
              Review queue is empty
            </h3>
            <p className="text-sm text-gray-400 leading-relaxed mb-4">
              Items appear here automatically when Alec's responses score below
              the quality threshold. Each flagged turn can be approved (used
              verbatim in fine-tuning) or rejected (corrected before training).
            </p>
            <div className="text-xs text-gray-500 space-y-1">
              <div>• Chat with Alec to generate turns that can be scored</div>
              <div>• Responses with <code className="text-alec-accent">quality_score &lt; 0.6</code> are queued</div>
              <div>• Approvals feed the next fine-tune batch (every 50 items)</div>
            </div>
            <button
              onClick={async () => { setLoading(true); await load(); setLoading(false); }}
              className="mt-5 px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-accent/80 text-white text-sm transition-colors"
            >
              Refresh
            </button>
          </div>
        )}

        {!loading && queue.length > 0 && (
          <div className="flex flex-col gap-4 max-w-5xl mx-auto">
            {queue.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
