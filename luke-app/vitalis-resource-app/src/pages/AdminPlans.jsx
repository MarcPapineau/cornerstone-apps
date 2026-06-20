import { CreditCard, Info } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

/**
 * AdminPlans — the platform subscription-plan catalog. DISPLAY ONLY: the app processes no
 * payments; the entitlement cap (active generated protocols) is the operational lever. This is
 * a platform-operations surface — it never operates a client's protocols, labs, or add-ons.
 */
export default function AdminPlans() {
  const q = useFetch(() => api.plans(), []);
  if (q.loading) return <Loading label="Loading plans…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const plans = q.data?.plans || [];

  return (
    <>
      <PageHeader
        title="Subscription Plans"
        description="The platform plan catalog and the active-protocol entitlement each tier allows."
        actions={<Badge tone="accent"><CreditCard className="h-3 w-3" /> {plans.length} plans</Badge>}
      />
      <Card>
        <CardContent className="px-0 pb-1">
          {plans.length === 0 ? (
            <EmptyState title="No plans defined" icon={CreditCard} />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent"><TH className="pl-5">Plan</TH><TH>Active-protocol cap</TH><TH>Included add-ons</TH><TH className="pr-5">Notes</TH></TR>
              </THead>
              <TBody>
                {plans.map((p) => (
                  <TR key={p.key}>
                    <TD className="pl-5 font-medium text-foreground">{p.label}<span className="ml-2 font-data text-2xs uppercase text-faint">{p.key}</span></TD>
                    <TD className="font-data text-sm">{p.activeProtocolCap == null ? 'Unlimited' : p.activeProtocolCap}</TD>
                    <TD className="text-xs text-soft">{(p.includedAddOns || []).length ? p.includedAddOns.join(', ') : '—'}</TD>
                    <TD className="pr-5 text-xs text-soft">{p.note || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 flex items-start gap-1.5 text-2xs leading-relaxed text-faint">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        Display only — no payment processor is wired. A client's entitlement cap limits active generated protocols; it is an educational-resource limit, never a clinical one.
      </p>
    </>
  );
}
