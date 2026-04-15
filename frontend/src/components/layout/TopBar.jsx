import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_TITLES = {
  '/chat':      'Chat',
  '/dashboard': 'Dashboard',
  '/finance':   'Finance',
  '/deals':     'Portfolio & Pipeline',
  '/review':    'Review Queue',
  '/pdf':       'PDF Upload',
  '/settings':  'Settings',
};

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('alec-dark');
    return stored === 'true';
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [dark]);

  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem('alec-dark', String(next));
      document.documentElement.classList.toggle('dark');
      return next;
    });
  };

  return { dark, toggle };
}

function useHealthPoll() {
  const [healthy, setHealthy] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      fetch('/api/health')
        .then((res) => {
          if (!cancelled) setHealthy(res.ok);
        })
        .catch(() => {
          if (!cancelled) setHealthy(false);
        });
    };

    check();
    const id = setInterval(check, 30000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return healthy;
}

export default function TopBar() {
  const location = useLocation();
  const title = ROUTE_TITLES[location.pathname] ?? 'A.L.E.C.';
  const { dark, toggle } = useDarkMode();
  const healthy = useHealthPoll();

  return (
    <header className="h-12 flex items-center justify-between px-4 bg-alec-800 border-b border-alec-700 flex-shrink-0">
      <span className="font-semibold text-white text-sm">{title}</span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5" title={healthy === null ? 'Checking…' : healthy ? 'Backend healthy' : 'Backend unreachable'}>
          <span
            className={[
              'w-2 h-2 rounded-full',
              healthy === null ? 'bg-gray-400' : healthy ? 'bg-green-400' : 'bg-red-400',
            ].join(' ')}
          />
          <span className="text-xs text-gray-400">
            {healthy === null ? 'checking' : healthy ? 'online' : 'offline'}
          </span>
        </div>
        <button
          onClick={toggle}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-alec-700"
          aria-label="Toggle dark mode"
        >
          {dark ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>
    </header>
  );
}
