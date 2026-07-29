import { Gauge, Layers, UserCog, Infinity as InfinityIcon } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import ProgressRing from '../components/charts/ProgressRing.jsx';
import { DashboardHero, StatusRibbon } from '../components/dashboard/composers.jsx';

/**
 * PortalUsage — the client's "My Plan" surface. It reports how many active protocols
 * this client currently holds against their plan's allowance, sourced entirely from
 * api.clientEntitlements(clientId). The cap is an educational-resource limit the server
 * computes and enforces; this page only renders the server's numbers and never gates or
 * decides anything itself. No payment UI — this is a transparency view, not a checkout.
 * The used/cap meter is the canonical ProgressRing (honest "Unlimited" when there is no cap).
 */
export default function PortalUsage() {
  const { clientId } = useRole();
  const entQ = useFetch(() => (clientId ? api.clientEntitlements(clientId) : Promise.resolve(null)), [clientId]);

  if (!clientId) {
    return (
      <div className="space-y-6">
        <DashboardHero eyebrow="My Vitalis Health" title="My Plan" icon={Gauge} subtitle="Your plan and active-protocol allowance." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher to view their portal." icon={UserCog} /></CardContent></Card>
      </div>
    );
  }

  if (entQ.loading) return <Loading label="Loading your plan…" />;
  if (entQ.error) return <ErrorState error={entQ.error} />;

  const entitlement = entQ.data?.entitlement || null;
  const plan = entQ.data?.plan || null;
  const usage = entQ.data?.usage || { cap: null, used: 0, remaining: null, blocked: false };
  const tiers = entQ.data?.tiers || [];

  const unlimited = usage.cap === null;
  const capLabel = unlimited ? 'Unlimited' : usage.cap;
  const remainingLabel = unlimited ? 'Unlimited' : usage.remaining;

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="My Vitalis Health" title="My Plan" icon={Gauge}
        subtitle="Your plan and how many active protocols it includes. This is an educational-resource allowance — not a clinical limit."
        ribbons={usage.blocked
          ? <StatusRibbon tone="danger">At limit</StatusRibbon>
          : <StatusRibbon tone="teal">{plan?.label || 'Your plan'}</StatusRibbon>}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-1.5"><Gauge className="h-4 w-4 text-primary" /> {plan?.label || 'Your plan'}</CardTitle>
            {usage.blocked && <Badge tone="danger">At limit</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
            {unlimited ? (
              <ProgressRing value={null} max={1} size={120} stroke={11} tone="teal" label={<InfinityIcon className="h-6 w-6 text-primary" />} sublabel="no cap" />
            ) : (
              <ProgressRing value={usage.used} max={usage.cap} size={120} stroke={11} tone={usage.blocked ? 'danger' : 'gold'} label={`${usage.used}/${usage.cap}`} sublabel="active" />
            )}
            <div className="min-w-0 flex-1 space-y-1.5 text-center sm:text-left">
              <div className="text-sm text-foreground">
                Active protocols: <span className="font-semibold">{usage.used}</span> of <span className="font-semibold">{capLabel}</span>
              </div>
              <div className="text-xs text-soft">{remainingLabel} remaining</div>
              <p className="text-2xs leading-relaxed text-faint">This is an educational-resource limit, not a clinical one.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <SectionHeader eyebrow="Options" title="Plans" />
        <Card>
          <CardContent className="pt-4">
            {tiers.length === 0 ? (
              <EmptyState title="No plans available" hint="Plan options will appear here once configured." icon={Layers} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent"><TH>Plan</TH><TH>Active protocols</TH><TH>Notes</TH></TR>
                </THead>
                <TBody>
                  {tiers.map((t) => {
                    const current = entitlement && t.key === entitlement.planKey;
                    return (
                      <TR key={t.key} className="hover:bg-transparent">
                        <TD className="font-medium text-foreground">
                          <span className="flex flex-wrap items-center gap-2">
                            {t.label}
                            {current && <Badge tone="accent">Current</Badge>}
                          </span>
                        </TD>
                        <TD className="text-xs font-data">{t.activeProtocolCap === null ? 'Unlimited' : t.activeProtocolCap}</TD>
                        <TD className="text-xs text-soft">{t.note || '—'}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
