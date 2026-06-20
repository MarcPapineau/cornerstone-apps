import { useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus, Gauge, AlertTriangle, FlaskConical } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const noop = () => Promise.resolve(null);
const FLAG_TONE = { SUCCESS: 'success', NEEDS_ADJUSTMENT: 'warning', FAILURE: 'danger', PENDING: 'neutral' };
const numOrUndef = (v) => (v === '' || v == null ? undefined : Number(v));
const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = { weightKg: '', bodyFatPct: '', leanMassKg: '', adherencePct: '', sideEffects: '', notes: '' };

function Delta({ label, value, unit }) {
  const has = value != null;
  const Icon = !has ? Minus : value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <div className="rounded-md border border-border-soft p-3">
      <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-faint" />
        <span className="font-data text-lg font-semibold tracking-tight text-foreground">
          {has ? `${value > 0 ? '+' : ''}${value}` : '—'}
        </span>
        {has && unit && <span className="text-2xs text-faint">{unit}</span>}
      </div>
    </div>
  );
}

export default function Outcomes() {
  const [clientId, setClientId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const outcomesQ = useFetch(() => (clientId ? api.outcomes(clientId) : noop()), [clientId]);
  const scorecardQ = useFetch(() => (clientId ? api.scorecard(clientId) : noop()), [clientId]);

  const outcomes = outcomesQ.data?.outcomes || [];
  const scorecard = scorecardQ.data?.scorecard;

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const series = outcomes
    .slice()
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
    .map((o) => ({
      date: (o.recordedAt || '').slice(5, 10),
      Weight: o.weightKg ?? null,
      'Lean Mass': o.leanMassKg ?? null,
      'Body Fat %': o.bodyFatPct ?? null,
    }));

  async function submit(e) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await api.createOutcome({
        clientId,
        weightKg: numOrUndef(form.weightKg),
        bodyFatPct: numOrUndef(form.bodyFatPct),
        leanMassKg: numOrUndef(form.leanMassKg),
        adherencePct: numOrUndef(form.adherencePct),
        sideEffects: splitList(form.sideEffects),
        notes: form.notes.trim(),
      });
      setForm(EMPTY);
      outcomesQ.reload();
      scorecardQ.reload();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Scorecard & Outcomes"
        description="Recorded outcome metrics and a protocol scorecard over time. The flag is an honest, non-clinical heuristic — operator-facing, never a medical judgement."
        actions={<StatusChip tone="accent" label="Heuristic Only — Not Clinical" />}
      />

      <div className="mb-5 max-w-xs">
        <ClientPicker value={clientId} onChange={setClientId} autoSelectFirst />
      </div>

      {!clientId ? (
        <EmptyState title="Select a client" hint="Pick a client to record outcomes and compute their scorecard." icon={Activity} />
      ) : (
        <>
          <Card className="mb-5">
            <CardHeader className="flex-row items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
                <Gauge className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle>Protocol scorecard</CardTitle>
                  {scorecard && <StatusChip tone={FLAG_TONE[scorecard.outcomeFlag] || 'neutral'} label={String(scorecard.outcomeFlag).replace(/_/g, ' ')} />}
                </div>
                <CardDescription>Deltas are first→latest. The flag is a transparent heuristic — never a clinical judgement.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {scorecardQ.loading ? (
                <Loading />
              ) : scorecardQ.error ? (
                <ErrorState error={scorecardQ.error} />
              ) : !scorecard ? null : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Delta label="Weight Δ" value={scorecard.deltas?.weightKg} unit="kg" />
                    <Delta label="Body Fat Δ" value={scorecard.deltas?.bodyFatPct} unit="%" />
                    <Delta label="Lean Mass Δ" value={scorecard.deltas?.leanMassKg} unit="kg" />
                    <div className="rounded-md border border-border-soft p-3">
                      <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Adherence avg</div>
                      <div className="mt-1 font-data text-lg font-semibold tracking-tight text-foreground">
                        {scorecard.adherenceAvg != null ? `${scorecard.adherenceAvg}%` : '—'}
                      </div>
                    </div>
                  </div>

                  {(scorecard.sideEffectsSeen || []).length > 0 && (
                    <div className="rounded-md border border-warning/25 bg-warning-soft p-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" /> Side-effects reported
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {scorecard.sideEffectsSeen.map((s) => (
                          <Badge key={s} tone="warning">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {scorecard.learnings && (
                    <p className="border-t border-border-soft pt-3 text-xs text-faint">{scorecard.learnings}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Outcome trend</CardTitle>
              <CardDescription>Recorded metrics over time. Raw datapoints — no clinical inference is drawn.</CardDescription>
            </CardHeader>
            <CardContent>
              {outcomesQ.loading ? (
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

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex-row items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
                  <Activity className="h-4.5 w-4.5" />
                </div>
                <div>
                  <CardTitle>Record an outcome</CardTitle>
                  <CardDescription>A datapoint snapshot. Recomputes the scorecard heuristic on save.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={submit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <FormField label="Weight (kg)">
                      <Input value={form.weightKg} onChange={setField('weightKg')} placeholder="84.0" type="number" step="any" />
                    </FormField>
                    <FormField label="Body fat %">
                      <Input value={form.bodyFatPct} onChange={setField('bodyFatPct')} placeholder="22.5" type="number" step="any" />
                    </FormField>
                    <FormField label="Lean mass (kg)">
                      <Input value={form.leanMassKg} onChange={setField('leanMassKg')} placeholder="65.0" type="number" step="any" />
                    </FormField>
                    <FormField label="Adherence %">
                      <Input value={form.adherencePct} onChange={setField('adherencePct')} placeholder="90" type="number" step="any" min="0" max="100" />
                    </FormField>
                  </div>
                  <FormField label="Side-effects" hint="Comma-separated — left empty if none reported.">
                    <Input value={form.sideEffects} onChange={setField('sideEffects')} placeholder="mild nausea, injection-site redness" />
                  </FormField>
                  <FormField label="Notes">
                    <Input value={form.notes} onChange={setField('notes')} placeholder="Week 6 check-in" />
                  </FormField>
                  {saveErr && <ErrorState error={saveErr} />}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={saving || !clientId}>{saving ? 'Saving…' : 'Record outcome'}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>History</CardTitle>
                <CardDescription>Every recorded datapoint for this client.</CardDescription>
              </CardHeader>
              <CardContent className="px-0 pb-1">
                {outcomesQ.loading ? (
                  <div className="px-5"><Loading /></div>
                ) : outcomesQ.error ? (
                  <div className="px-5"><ErrorState error={outcomesQ.error} /></div>
                ) : outcomes.length === 0 ? (
                  <div className="px-5"><EmptyState title="No outcomes yet" hint="Record the first datapoint with the form." icon={Activity} /></div>
                ) : (
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH className="pl-5">Date</TH><TH>Weight</TH><TH>Fat %</TH><TH className="pr-5">Adh.</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {outcomes
                        .slice()
                        .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
                        .map((o) => (
                          <TR key={o.id} className="hover:bg-transparent">
                            <TD className="pl-5 text-xs text-faint">{fmtDate(o.recordedAt)}</TD>
                            <TD className="font-data text-xs">{o.weightKg ?? '—'}</TD>
                            <TD className="font-data text-xs">{o.bodyFatPct ?? '—'}</TD>
                            <TD className="pr-5 font-data text-xs">{o.adherencePct != null ? `${o.adherencePct}%` : '—'}</TD>
                          </TR>
                        ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
