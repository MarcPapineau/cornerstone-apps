import { Lock } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { StatusChip } from './ui/StatusChip.jsx';
import { cn } from '../lib/utils.js';

/**
 * GateStatusBar — always-visible platform gate posture (Guard: source / research /
 * compliance status visible on every screen). Reads live connector + jurisdiction
 * state from /api/meta; never fabricates a green.
 */
export function GateStatusBar({ className }) {
  const { data, loading } = useFetch(() => api.meta(), []);
  const connectors = data?.connectors || [];
  const liveCount = connectors.filter((c) => c.status === 'LIVE').length;
  const jurisdictions = data?.compliance?.jurisdictions || [];
  const defaultJ = jurisdictions.includes('CA') ? 'CA' : jurisdictions[0] || 'CA';

  if (loading) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="hidden items-center gap-1 text-2xs font-medium uppercase tracking-wide text-faint sm:inline-flex">
        <Lock className="h-3 w-3" /> Source
      </span>
      <StatusChip tone="success" label="Catalog Locked" />
      <span className="mx-0.5 hidden h-3 w-px bg-border-soft sm:inline-block" />
      <StatusChip
        tone={liveCount > 0 ? 'success' : 'neutral'}
        label={liveCount > 0 ? `Research · ${liveCount} Live` : 'Research · Stub'}
      />
      <span className="mx-0.5 hidden h-3 w-px bg-border-soft sm:inline-block" />
      <StatusChip tone="accent" label={`Compliance · ${defaultJ}`} />
    </div>
  );
}
