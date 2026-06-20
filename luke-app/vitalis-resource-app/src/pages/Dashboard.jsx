import {
  Users, FileText, ClipboardList, TestTubes, ShieldAlert, Microscope, FlaskConical,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { cn, fmtInt, fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/Card.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

function StatCard({ icon: Icon, label, value, tone = 'neutral', hint }) {
  const ring = {
    neutral: 'text-faint',
    accent: 'text-primary',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-soft">{label}</span>
        <Icon className={cn('h-4 w-4', ring)} />
      </div>
      <div className="mt-2 font-data text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-1 text-2xs text-faint">{hint}</div>}
    </Card>
  );
}

export default function Dashboard() {
  const dash = useFetch(() => api.dashboard(), []);
  const drafts = useFetch(() => api.drafts(), []);
  const outcomes = useFetch(() => api.outcomes(), []);

  if (dash.loading) return <Loading label="Loading dashboard…" />;
  if (dash.error) return <ErrorState error={dash.error} />;

  const counts = dash.data?.counts || {};
  const demo = dash.data?.demo;
  const draftRows = drafts.data?.drafts || [];

  // Outcome trend: most-populated demo client, plotted over time (guarded).
  const allOutcomes = outcomes.data?.outcomes || [];
  const byClient = allOutcomes.reduce((m, o) => ((m[o.clientId] = m[o.clientId] || []).push(o), m), {});
  const topClient = Object.values(byClient).sort((a, b) => b.length - a.length)[0] || [];
  const series = topClient
    .slice()
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
    .map((o) => ({
      date: (o.recordedAt || '').slice(5, 10),
      Weight: o.weightKg ?? null,
      'Lean Mass': o.leanMassKg ?? null,
      'Body Fat %': o.bodyFatPct ?? null,
    }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Operational overview of the protocol pipeline. Every figure is gate-checked server-side — the surface only asks, it never decides."
        actions={demo?.count != null && <Badge tone="warning">{fmtInt(demo.count)} demo clients</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} label="Clients" value={fmtInt(counts.clients)} tone="neutral" />
        <StatCard icon={FileText} label="Draft Protocols" value={fmtInt(counts.draftProtocols)} tone="accent" hint="DRAFT / resource-only" />
        <StatCard icon={ClipboardList} label="Pending Labs" value={fmtInt(counts.pendingLabs)} tone={counts.pendingLabs > 0 ? 'warning' : 'neutral'} hint="clients with no labs" />
        <StatCard icon={TestTubes} label="Flagged Labs" value={fmtInt(counts.flaggedLabs)} tone={counts.flaggedLabs > 0 ? 'danger' : 'success'} hint="provider review suggested" />
        <StatCard icon={ShieldAlert} label="Compliance" value={fmtInt(counts.complianceWarnings)} tone={counts.complianceWarnings > 0 ? 'warning' : 'success'} hint="draft items to review" />
        <StatCard icon={Microscope} label="Research Gaps" value={fmtInt(counts.researchGaps)} tone={counts.researchGaps > 0 ? 'warning' : 'success'} hint="UNKNOWN evidence" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Drafts</CardTitle>
            <CardDescription>Protocol drafts stay DRAFT / resource-only until a provider review is recorded.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            {drafts.loading ? (
              <Loading />
            ) : draftRows.length === 0 ? (
              <EmptyState title="No drafts yet" hint="Assemble a protocol in the Draft Builder to see it here." icon={FileText} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="pl-5">Draft</TH>
                    <TH>Items</TH>
                    <TH>Compliance</TH>
                    <TH>Status</TH>
                    <TH className="pr-5">Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {draftRows.slice(0, 6).map((d) => (
                    <TR key={d.id}>
                      <TD className="pl-5 font-data text-xs text-foreground">{d.id}</TD>
                      <TD>{fmtInt((d.items || []).length)}</TD>
                      <TD><StatusChip status={d.jurisdiction || 'CA'} tone="accent" label={d.jurisdiction || 'CA'} /></TD>
                      <TD><StatusChip status={d.status} /></TD>
                      <TD className="pr-5 text-xs text-faint">{fmtDate(d.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gate Posture</CardTitle>
            <CardDescription>Server-authoritative guards, always on.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {[
              ['Source-of-truth catalog', 'Catalog Locked', 'success'],
              ['Route / form integrity', 'SubQ ≠ Oral', 'success'],
              ['Research before recommend', 'Enforced', 'success'],
              ['No fabricated citations', 'Enforced', 'success'],
              ['No medical-claim language', 'Blocked', 'success'],
              ['Abnormal lab handling', 'Review Suggested', 'accent'],
              ['Compliance jurisdiction', 'CA Default', 'accent'],
              ['Draft status', 'Resource-Only', 'accent'],
            ].map(([label, val, tone]) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <span className="text-xs text-soft">{label}</span>
                <StatusChip tone={tone} label={val} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Outcome Trend</CardTitle>
          <CardDescription>
            Recorded outcome metrics over time (most-tracked demo client). Heuristic only — never a clinical judgement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {outcomes.loading ? (
            <Loading />
          ) : series.length < 2 ? (
            <EmptyState title="Not enough datapoints" hint="At least two outcome records are needed to chart a trend." icon={FlaskConical} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--chart-axis))" fontSize={11} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} />
                  <YAxis stroke="hsl(var(--chart-axis))" fontSize={11} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12,
                      boxShadow: '0 2px 6px -1px hsl(220 28% 12% / 0.10)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="Weight" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="Lean Mass" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="Body Fat %" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
