import { create } from 'zustand';
import { getQueue, approve, reject, getFineTuneStatus } from '../api/review';

export const useReviewStore = create((set) => ({
  queue: [],
  status: null,
  load: async () => {
    const [queueResult, status] = await Promise.all([getQueue(), getFineTuneStatus()]);
    set({ queue: queueResult.items ?? [], status });
  },
  handleApprove: async (id) => {
    await approve(id);
    set((s) => ({ queue: s.queue.filter((c) => c.id !== id) }));
  },
  handleReject: async (id) => {
    await reject(id);
    set((s) => ({ queue: s.queue.filter((c) => c.id !== id) }));
  },
}));
