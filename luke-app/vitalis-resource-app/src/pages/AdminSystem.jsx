import { useState } from 'react';
import { Activity, Database, RotateCcw, Stethoscope, Users, FileText, BadgeCheck } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { cn, fmtInt } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

function Stat({ icon: Icon, label, value, tone = 'neutral' }) {
  const ring = { neutral: 'text-faint', accent: 'text-primary', success: 'text-success', warning: 'text-warning' }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between"><span className="text-xs font-medium text-soft">{label}</span><Icon className={cn('h-4 w-4', ring)} /></div>
      <div className="mt-2 font-data text-2xl font-semibold tracking-tight text-foreground">{value}</div>
    </Card>
  );
}

/**
 * AdminSystem — platform System Health: the honest research-source registry (LIVE / STUB /
 * PLANNED — UNKNOWN beats fake green), platform counts, and the demo-data control. Operations,
 * not client work. Resetting demo data re-seeds the store; it never touches a real tenant.
 */
export default function AdminSystem() {
  const sourcesQ = useFetch(() => api.researchSources(), []);
  const ovQ = useFetch(() => api.adminOverview(), []);
  const [resetting, setResetting] = useState(false);
  const [resetErr, setResetErr] = useState(null);
  const [resetOk, setResetOk] = useState(false);

  async function reset() {
    setResetting(true); setResetErr(null); setResetOk(false);
    try { await api.resetDemo(); setResetOk(true); ovQ.reload(); } catch (e) { setResetErr(e); } finally { setResetting(false); }
  }

  if (sourcesQ.loading) return <Loading label="Loading system health…" />;
  if (sourcesQ.error) return <ErrorState error={sourcesQ.error} />;

  const sources = sourcesQ.data?.sources || [];
  const summary = sourcesQ.data?.summary || {};
  const counts = ovQ.data?.counts || {};
  const demoCount = ovQ.data?.demo?.clientCount;

  return (
    <>
      <PageHeader
        title="System Health"
        description="Research-source registry, platform counts, and demo-data control. UNKNOWN beats fake green — a source is only LIVE when its connector actually is."
        actions={<Badge tone="accent"><Activity className="h-3 w-3" /> {summary.live ?? 0} live · {summary.stub ?? 0} stub · {summary.planned ?? 0} planned</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Stethoscope} label="Practitioners" value={fmtInt(counts.practitioners)} tone="accent" />
        <Stat icon={Users} label="Clients" value={fmtInt(counts.clients)} />
        <Stat icon={FileText} label="Drafts awaiting review" value={fmtInt(counts.draftsAwaiting)} tone="warning" />
        <Stat icon={BadgeCheck} label="Approved Resources" value={fmtInt(counts.approvedResources)} tone="success" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Research source registry</CardTitle><CardDescription>Every evidence source declares its real status — never claims LIVE unless its connector is wired.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            {sources.length === 0 ? (
              <EmptyState title="No sources registered" icon={Database} />
            ) : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH className="pl-5">Source</TH><TH>Region</TH><TH className="pr-5">Status</TH></TR></THead>
                <TBody>
                  {sources.map((s) => (
                    <TR key={s.id}>
                      <TD className="pl-5"><span className="font-medium text-foreground">{s.label}</span>{s.note ? <span className="block text-2xs text-faint">{s.note}</span> : null}</TD>
                      <TD className="font-data text-2xs uppercase text-soft">{s.jurisdiction || '—'}</TD>
                      <TD className="pr-5"><StatusChip status={s.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Database className="h-4 w-4 text-faint" /> Demo data</CardTitle><CardDescription>Re-seed the store from the hand-authored demo fixtures.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {demoCount != null && <p className="text-xs text-soft">{fmtInt(demoCount)} demo clients currently seeded.</p>}
            <Button variant="outline" onClick={reset} disabled={resetting}><RotateCcw className="h-4 w-4" /> {resetting ? 'Resetting…' : 'Reset demo data'}</Button>
            {resetOk && <p className="text-xs font-medium text-success">Demo data re-seeded.</p>}
            {resetErr && <ErrorState error={resetErr} />}
            <p className="text-2xs leading-relaxed text-faint">Re-seeding only affects clearly-flagged demo records. There is no real tenant data in this build.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
