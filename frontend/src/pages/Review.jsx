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
          <div className="flex items-center justify-center h-32 text-gray-500">
            No items in review queue.
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
