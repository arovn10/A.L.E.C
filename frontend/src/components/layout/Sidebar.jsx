import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/chat',      label: 'Chat',      icon: '💬' },
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/finance',   label: 'Finance',   icon: '🏦' },
  { path: '/deals',     label: 'Portfolio', icon: '🏗️' },
  { path: '/review',    label: 'Review',    icon: '✅' },
  { path: '/pdf',       label: 'PDF',       icon: '📄' },
  { path: '/settings',  label: 'Settings',  icon: '⚙️' },
];

export default function Sidebar() {
  return (
    <aside className="w-56 flex-shrink-0 bg-alec-800 flex flex-col h-screen">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-alec-700">
        <span className="text-alec-accent font-bold text-xl tracking-wide">A.L.E.C.</span>
      </div>
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV_ITEMS.map(({ path, label, icon }) => (
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
