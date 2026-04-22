import { useState, useEffect } from 'react';
import PlaidLinkSection from '../components/settings/PlaidLinkSection';

// Inline hook: reads/writes a boolean from localStorage, syncing on mount.
function useLocalStorageToggle(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === 'true';
  });

  function toggle() {
    setValue((prev) => {
      const next = !prev;
      localStorage.setItem(key, String(next));

      // Special side-effect: dark mode syncs with <html> class
      if (key === 'alec-dark') {
        if (next) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }

      return next;
    });
  }

  // Sync dark mode class on initial mount
  useEffect(() => {
    if (key === 'alec-dark') {
      if (value) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return [value, toggle];
}

function ToggleRow({ label, value, onToggle }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-700 last:border-0">
      <span className="text-sm text-gray-200">{label}</span>
      <button
        role="switch"
        aria-checked={value}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-alec-accent focus:ring-offset-2 focus:ring-offset-alec-900 ${
          value ? 'bg-alec-accent' : 'bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function Settings() {
  const [darkMode, toggleDarkMode] = useLocalStorageToggle('alec-dark', true);
  const [streaming, toggleStreaming] = useLocalStorageToggle('alec-streaming', true);
  const [ragEnabled, toggleRag] = useLocalStorageToggle('alec-rag', true);
  const [sound, toggleSound] = useLocalStorageToggle('alec-sound', false);

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">
      {/* Section 1: Preferences */}
      <section>
        <h1 className="text-xl font-bold text-white mb-4">Preferences</h1>
        <div className="rounded-xl bg-alec-800 border border-gray-700 px-5 py-1">
          <ToggleRow label="Dark Mode" value={darkMode} onToggle={toggleDarkMode} />
          <ToggleRow label="Streaming Chat" value={streaming} onToggle={toggleStreaming} />
          <ToggleRow label="RAG Context Injection" value={ragEnabled} onToggle={toggleRag} />
          <ToggleRow label="Message Sound" value={sound} onToggle={toggleSound} />
        </div>
      </section>

      {/* Section 2: Bank Account (Plaid) */}
      <section>
        <h1 className="text-xl font-bold text-white mb-4">Bank Account (Plaid)</h1>
        <div className="rounded-xl bg-alec-800 border border-gray-700 px-5 py-5">
          <PlaidLinkSection />
        </div>
      </section>

      {/* Section 3: About A.L.E.C. */}
      <section>
        <h1 className="text-xl font-bold text-white mb-4">About A.L.E.C.</h1>
        <div className="rounded-xl bg-alec-800 border border-gray-700 px-5 py-5 text-sm text-gray-300 space-y-1">
          <p>Adaptive Learning Executive Coordinator</p>
          <p>Built by Alec Rovner | Stoa Group</p>
          <p>Plans A-E complete</p>
        </div>
      </section>
    </div>
  );
}
