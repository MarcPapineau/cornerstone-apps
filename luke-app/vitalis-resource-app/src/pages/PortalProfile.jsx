import { UserRound, UserCog, VenetianMask, Cake, Scale, Percent, Dumbbell } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatCard } from '../components/ui/StatCard.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { DashboardHero, StatusRibbon } from '../components/dashboard/composers.jsx';

/**
 * PortalProfile — the client's intake profile on file. Reuses DashboardHero + a StatCard rail for
 * the biometric facts (sex / age / weight / body-fat / lean-mass), then surfaces goals, current
 * products and contraindications as restrained badge groups. Read-only; nothing here is clinical.
 */
export default function PortalProfile() {
  const { clientId } = useRole();
  const clientQ = useFetch(() => (clientId ? api.client(clientId) : Promise.resolve(null)), [clientId]);

  if (!clientId) {
    return (
      <div className="space-y-6">
        <DashboardHero eyebrow="My Vitalis Health" title="My Profile" icon={UserRound} subtitle="Your intake profile." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </div>
    );
  }
  if (clientQ.loading) return <Loading label="Loading your profile…" />;
  if (clientQ.error) return <ErrorState error={clientQ.error} />;
  const c = clientQ.data?.client || {};

  const stats = [
    { label: 'Sex', value: c.sex || '—', icon: VenetianMask, tone: 'primary' },
    { label: 'Age', value: c.age != null ? `${c.age}y` : '—', icon: Cake, tone: 'gold' },
    { label: 'Weight', value: c.weightKg != null ? `${c.weightKg} kg` : '—', icon: Scale, tone: 'primary' },
    { label: 'Body fat', value: c.bodyFatPct != null ? `${c.bodyFatPct}%` : '—', icon: Percent, tone: 'success' },
    { label: 'Lean mass', value: c.leanMassKg != null ? `${c.leanMassKg} kg` : '—', icon: Dumbbell, tone: 'primary' },
  ];

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="My Vitalis Health" title={c.name || 'My Profile'} icon={UserRound}
        subtitle={`The intake details on file with your practice.${c.createdAt ? ` Added ${fmtDate(c.createdAt)}.` : ''}`}
        ribbons={c._demo ? <StatusRibbon tone="warning">demo</StatusRibbon> : null}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} />)}
      </div>

      <div className="space-y-3">
        <SectionHeader eyebrow="On file" title="Intake details" />
        <Card>
          <CardContent className="space-y-3 pt-4">
            {(c.goals || []).length > 0 && (
              <div><div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Goals</div>
                <div className="flex flex-wrap gap-1.5">{c.goals.map((g) => <Badge key={g} tone="accent">{g}</Badge>)}</div></div>
            )}
            {(c.currentProducts || []).length > 0 && (
              <div><div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Current products</div>
                <div className="flex flex-wrap gap-1.5">{c.currentProducts.map((g) => <Badge key={g} tone="neutral">{g}</Badge>)}</div></div>
            )}
            {(c.contraindications || []).length > 0 && (
              <div><div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Contraindications</div>
                <div className="flex flex-wrap gap-1.5">{c.contraindications.map((g) => <Badge key={g} tone="danger">{g}</Badge>)}</div></div>
            )}
            {!((c.goals || []).length || (c.currentProducts || []).length || (c.contraindications || []).length) && !c.notes && (
              <EmptyState title="No additional details" hint="Goals, current products and notes from your intake appear here." icon={UserRound} />
            )}
            {c.notes && <p className="border-t border-border-soft pt-3 text-xs text-soft">{c.notes}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
