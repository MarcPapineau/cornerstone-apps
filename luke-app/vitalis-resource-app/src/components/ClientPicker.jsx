import { useEffect } from 'react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Label, Select } from './ui/Field.jsx';

/**
 * ClientPicker — shared controlled client selector. Several modules operate on a
 * single client (labs, draft, referrals, outcomes); this keeps the selection UI and
 * the demo-tagging consistent. Auto-selects the first client so a page is never empty
 * by accident on a populated store.
 */
export function ClientPicker({ value, onChange, autoSelectFirst = true, label = 'Client', className, hint }) {
  const { data, loading } = useFetch(() => api.clients(), []);
  const clients = data?.clients || [];

  useEffect(() => {
    if (autoSelectFirst && !value && clients.length) onChange(clients[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.length]);

  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      <Select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || '')}
        disabled={loading || !clients.length}
      >
        {!clients.length && <option value="">{loading ? 'Loading clients…' : 'No clients yet'}</option>}
        {clients.length > 0 && !value && <option value="">Select a client…</option>}
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c._demo ? ' · demo' : ''}
          </option>
        ))}
      </Select>
      {hint && <p className="mt-1 text-2xs text-faint">{hint}</p>}
    </div>
  );
}
