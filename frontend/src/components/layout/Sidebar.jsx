import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getMe } from '../../api/admin';

// requiredRole ∈ { 'Admin', 'Master' } | undefined (visible to anyone authed)
const NAV_ITEMS = [
  { path: '/chat',      label: 'Chat',      icon: '💬' },
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/finance',   label: 'Finance',   icon: '🏦' },
  { path: '/deals',     label: 'Portfolio', icon: '🏗️' },
  { path: '/review',    label: 'Review',    icon: '✅' },
  { path: '/pdf',       label: 'PDF',       icon: '📄' },
  { path: '/admin',     label: 'Admin',     icon: '👥', requiredRole: 'Admin' },
  { path: '/settings',  label: 'Settings',  icon: '⚙️' },
];

// Role precedence — higher index = more privileged.
const ROLE_ORDER = ['Viewer', 'Manager', 'Admin', 'Master'];
function hasRole(userRole, required) {
  if (!required) return true;
  const u = ROLE_ORDER.indexOf(userRole);
  const r = ROLE_ORDER.indexOf(required);
  if (u < 0 || r < 0) return false;
  return u >= r;
}

export default function Sidebar() {
  const [role, setRole] = useState(null);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Cheap local-first guess; we'll confirm via /me. Either way we render
    // something immediately rather than blocking the whole sidebar.
    try {
      const cached = localStorage.getItem('alec_user_role');
      if (cached && !cancelled) setRole(cached);
    } catch {}
    (async () => {
      try {
        const r = await getMe();
        const u = r?.user || r?.data?.user || r?.data || r;
        const resolved = u?.role || u?.Role || null;
        if (!cancelled && resolved) {
          setRole(resolved);
          try { localStorage.setItem('alec_user_role', resolved); } catch {}
        }
      } catch {
        // Unauth or offline — hide privileged links by default.
      } finally {
        if (!cancelled) setProbed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="w-56 flex-shrink-0 bg-alec-800 flex flex-col h-screen">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-alec-700">
        <span className="text-alec-accent font-bold text-xl tracking-wide">A.L.E.C.</span>
        {probed && role && (
          <span className="ml-auto text-[10px] uppercase text-alec-400">{role}</span>
        )}
      </div>
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV_ITEMS.filter(i => hasRole(role, i.requiredRole)).map(({ path, label, icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-alec-accent/20 border-l-2 border-alec-accent text-white'
                  : 'text-gray-400 hover:text-white hover:bg-alec-700 border-l-2 border-transparent',
              ].join(' ')
            }
          >
            <span className="text-base">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
