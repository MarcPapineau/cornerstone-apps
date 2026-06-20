import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Stethoscope, Users, UserCheck, FileText, ClipboardCheck, BadgeCheck, Pill, UtensilsCrossed, Timer, CircleDollarSign } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { cn, fmtInt } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Label, Select } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const ACCESS = ['ACTIVE', 'SUSPENDED', 'INVITED', 'PENDING_REVIEW'];
const ACCESS_TONE = { ACTIVE: 'success', SUSPENDED: 'danger', INVITED: 'accent', PENDING_REVIEW: 'warning' };
const PLANS = ['free', 'plus', 'pro'];

function Stat({ icon: Icon, label, value, tone = 'neutral' }) {
  const ring = { neutral: 'text-faint', accent: 'text-primary', success: 'text-success', warning: 'text-warning' }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between"><span className="text-xs font-medium text-soft">{label}</span><Icon className={cn('h-4 w-4', ring)} /></div>
      <div className="mt-2 font-data text-2xl font-semibold tracking-tight text-foreground">{value}</div>
    </Card>
  );
}

export default function AdminPractitionerDetail() {
  const { id } = useParams();
  const q = useFetch(() => api.practitionerAnalytics(id), [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (q.loading) return <Loading label="Loading provider…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const p = q.data?.practitioner;
  if (!p) return <Card><CardContent className="py-10"><EmptyState title="Provider not found" icon={Stethoscope} /></CardContent></Card>;
  const s = q.data?.stats || {};
  const rev = s.revenue || {};

  async function patch(body) {
    setBusy(true); setErr(null);
    try { await api.updatePractitioner(id, body); q.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <>
      <Link to="/admin/practitioners" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-faint hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> Practitioners</Link>
      <PageHeader
        title={p.name}
        description={[p.credentials, p.discipline].filter(Boolean).join(' · ') || 'Provider profile'}
        actions={
          <div className="flex items-center gap-2">
            {p.practitionerType === 'OWNER' && <Badge tone="accent">Owner</Badge>}
            <StatusChip tone={ACCESS_TONE[p.accessStatus] || 'neutral'} label={p.accessStatus} />
            <Badge tone="neutral">{String(p.planLevel || 'free').toUpperCase()}</Badge>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Clients" value={fmtInt(s.clientCount)} />
        <Stat icon={UserCheck} label="Active clients" value={fmtInt(s.activeClients)} tone="accent" />
        <Stat icon={FileText} label="Protocols generated" value={fmtInt(s.protocolsGenerated)} />
        <Stat icon={BadgeCheck} label="Approved protocols" value={fmtInt(s.approvedProtocols)} tone="success" />
        <Stat icon={ClipboardCheck} label="Pending reviews" value={fmtInt(s.pendingReviews)} tone={s.pendingReviews ? 'warning' : 'neutral'} />
        <Stat icon={Pill} label="Supplement plans" value={fmtInt(s.supplementPlans)} />
        <Stat icon={UtensilsCrossed} label="Meal plans" value={fmtInt(s.mealPlans)} />
        <Stat icon={Timer} label="Avg approval" value={s.avgTurnaroundHours == null ? '—' : `${fmtInt(s.avgTurnaroundHours)}h`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="border-primary/15 bg-accent-soft/40">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><CircleDollarSign className="h-4 w-4 text-primary" /> Revenue (demo)</CardTitle><CardDescription>Display only — no payment processor.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-2xs font-semibold uppercase tracking-wide text-faint">MRR</div><div className="mt-0.5 font-data text-lg font-semibold text-foreground">${fmtInt(rev.mrr)}</div></div>
              <div><div className="text-2xs font-semibold uppercase tracking-wide text-faint">Add-ons</div><div className="mt-0.5 font-data text-lg font-semibold text-foreground">${fmtInt(rev.addOnRevenue)}</div></div>
              <div><div className="text-2xs font-semibold uppercase tracking-wide text-primary">Total</div><div className="mt-0.5 font-data text-lg font-semibold text-primary">${fmtInt(rev.total)}</div></div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Access & plan</CardTitle><CardDescription>Platform controls for this provider account.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div><Label>Access status</Label><Select value={p.accessStatus} disabled={busy} onChange={(e) => patch({ accessStatus: e.target.value })}>{ACCESS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
              <div><Label>Plan level</Label><Select value={p.planLevel} disabled={busy} onChange={(e) => patch({ planLevel: e.target.value })}>{PLANS.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</Select></div>
              <div>
                <Label>Client-portal access</Label>
                <Button variant={p.portalAccessEnabled ? 'outline' : 'subtle'} className={cn('w-full', p.portalAccessEnabled ? 'text-success' : 'text-faint')} disabled={busy} onClick={() => patch({ portalAccessEnabled: !p.portalAccessEnabled })}>
                  {p.portalAccessEnabled ? 'Enabled — disable' : 'Disabled — enable'}
                </Button>
              </div>
            </div>
            {p.accessStatus === 'SUSPENDED' && <p className="mt-3 text-xs text-danger">Suspended — this provider cannot operate until reactivated.</p>}
            {err && <div className="mt-3"><ErrorState error={err} /></div>}
            {p.note && <p className="mt-4 text-xs text-soft">{p.note}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
