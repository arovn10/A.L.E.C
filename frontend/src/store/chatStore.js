import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useChatStore = create(
  persist(
    (set) => ({
      messages: [],
      sessionId: crypto.randomUUID(),
      isStreaming: false,
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastAssistant: (token) =>
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: last.content + token };
          }
          return { messages: msgs };
        }),
      setStreaming: (v) => set({ isStreaming: v }),
      clearSession: () => set({ messages: [], sessionId: crypto.randomUUID() }),
    }),
    { name: 'alec-chat' }
  )
);
