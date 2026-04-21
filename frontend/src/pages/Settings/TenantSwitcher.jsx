/**
 * frontend/src/pages/Settings/TenantSwitcher.jsx
 *
 * Dropdown in the top bar that lets users flip between organizations they
 * belong to. Hidden when the user has zero or one memberships.
 */
import { useOrg } from '../../context/OrgContext.jsx';

export default function TenantSwitcher() {
  const { orgs, current, setCurrentId } = useOrg();
  if (!orgs || orgs.length <= 1) return null;
  return (
    <select
      aria-label="Current organization"
      value={current?.id || ''}
      onChange={(e) => setCurrentId(e.target.value)}
      className="text-xs bg-alec-700 text-gray-200 border border-alec-600 rounded px-2 py-1 hover:bg-alec-600 focus:outline-none"
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
