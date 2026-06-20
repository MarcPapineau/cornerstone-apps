import { useNavigate } from 'react-router-dom';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole, ROLE_ORDER, ROLE_LABELS, ROLE_HOME } from '../lib/roleContext.jsx';
import { cn } from '../lib/utils.js';

/**
 * RoleSwitcher — the DEMO identity control (no real auth tonight). Lets a single
 * browser walk all three surfaces: pick a role, then pick WHICH practitioner or
 * client you're standing in. Changing role navigates to that surface's home.
 *
 * This is a view selector only — it grants no access. Every page still asks the
 * server, which enforces the approval boundary regardless of what is selected here.
 */
export function RoleSwitcher() {
  const navigate = useNavigate();
  const { role, practitionerId, clientId, setRole, setPractitionerId, setClientId } = useRole();

  const { data: pracData } = useFetch(() => api.practitioners(), []);
  const { data: cliData } = useFetch(() => api.clients(), []);
  const practitioners = pracData?.practitioners || [];
  const clients = cliData?.clients || [];

  const chooseRole = (r) => {
    if (r !== role) {
      setRole(r);
      navigate(ROLE_HOME[r] || '/');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-2xs font-medium uppercase tracking-wide text-faint sm:block">View as</div>
      <div className="inline-flex items-center rounded-md border border-border-soft bg-muted p-0.5">
        {ROLE_ORDER.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => chooseRole(r)}
            className={cn(
              'rounded px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide transition-colors',
              r === role ? 'bg-card text-primary shadow-sm' : 'text-faint hover:text-soft',
            )}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {role === 'PRACTITIONER' && (
        <IdentitySelect
          value={practitionerId || ''}
          onChange={setPractitionerId}
          options={practitioners.map((p) => ({ value: p.id, label: p.name + (p._demo ? ' · demo' : '') }))}
          placeholder="Select practitioner…"
        />
      )}
      {role === 'CLIENT' && (
        <IdentitySelect
          value={clientId || ''}
          onChange={setClientId}
          options={clients.map((c) => ({ value: c.id, label: c.name + (c._demo ? ' · demo' : '') }))}
          placeholder="Select client…"
        />
      )}
    </div>
  );
}

function IdentitySelect({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 max-w-[11rem] appearance-none rounded-md border border-border-soft bg-card pl-2.5 pr-7 text-2xs font-medium text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {!value && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
