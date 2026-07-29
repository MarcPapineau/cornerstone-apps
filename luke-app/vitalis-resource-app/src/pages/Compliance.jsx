import { useState } from 'react';
import { ShieldCheck, Scale, Flag, Search } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { Input, Select } from '../components/ui/Field.jsx';
import { Spinner, Loading, ErrorState } from '../components/ui/States.jsx';

const STATUS_TONE = { ALLOWED_RESOURCE: 'success', NEEDS_REVIEW: 'warning', BLOCKED: 'danger', UNKNOWN: 'neutral' };
const tone = (s) => STATUS_TONE[s] || 'neutral';

export default function Compliance() {
  const cfg = useFetch(() => api.complianceConfig(), []);
  const [subject, setSubject] = useState('');
  const [jurisdiction, setJurisdiction] = useState('CA');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const jurisdictions = cfg.data?.jurisdictions || {};
  const flags = cfg.data?.flags || [];
  const statuses = cfg.data?.statuses || [];

  async function run(e) {
    e.preventDefault();
    if (!subject.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.complianceCheck(subject.trim(), jurisdiction);
      setCheck(res.check);
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Compliance Gate"
        description="Operational routing flags only — NOT legal advice. Canada is the default jurisdiction; US status is config-driven state-by-state and defaults to UNKNOWN until sourced."
        actions={<StatusChip tone="accent" label="CA Default" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Check a compound</CardTitle>
              <CardDescription>Returns the jurisdiction posture, elevated by any compound-class flag.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={run} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Retatrutide 10mg/vial" className="pl-9" />
                </div>
              </div>
              <Select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="w-28">
                {Object.values(jurisdictions).map((j) => (
                  <option key={j.code} value={j.code}>{j.code} · {j.label}</option>
                ))}
                {Object.keys(jurisdictions).length === 0 && <option value="CA">CA</option>}
              </Select>
              <Button type="submit" disabled={busy || !subject.trim()}>
                {busy ? <><Spinner className="text-primary-foreground" /> Checking…</> : 'Check'}
              </Button>
            </form>

            {err && <div className="mt-3"><ErrorState error={err} /></div>}

            {check && (
              <div className="mt-4 rounded-md border border-border-soft bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{check.subject}</span>
                  <StatusChip tone={tone(check.status)} label={check.status} />
                </div>
                <div className="mt-1 text-2xs text-faint">Jurisdiction: {check.jurisdiction}</div>
                {check.reason && <p className="mt-2 text-xs text-soft">{check.reason}</p>}
                {check.disclaimer && <p className="mt-2 border-t border-border-soft pt-2 text-2xs text-faint">{check.disclaimer}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <Scale className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Jurisdiction posture</CardTitle>
              <CardDescription>Default status by jurisdiction. US is a state-by-state skeleton.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {cfg.loading ? (
              <Loading />
            ) : cfg.error ? (
              <ErrorState error={cfg.error} />
            ) : (
              Object.values(jurisdictions).map((j) => (
                <div key={j.code} className="rounded-md border border-border-soft p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {j.label} <span className="font-data text-faint">({j.code})</span>
                      {j.isDefault && <Badge tone="accent" className="ml-1.5">default</Badge>}
                    </span>
                    <StatusChip tone={tone(j.default)} label={j.default} />
                  </div>
                  <p className="mt-1.5 text-2xs text-faint">{j.basis}</p>
                  {j.states && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.values(j.states).map((s) => (
                        <Badge key={s.label} tone="neutral">{s.label}: {s.status}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader className="flex-row items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
            <Flag className="h-4.5 w-4.5" />
          </div>
          <div>
            <CardTitle>Compound-class flags</CardTitle>
            <CardDescription>A name match elevates the jurisdiction default to the more cautious status. Conservative by design.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-1">
          {flags.length === 0 ? (
            <div className="px-5 pb-3"><Loading /></div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="pl-5">Matches</TH>
                  <TH>Status</TH>
                  <TH className="pr-5">Reason</TH>
                </TR>
              </THead>
              <TBody>
                {flags.map((f, i) => (
                  <TR key={i}>
                    <TD className="pl-5">
                      <div className="flex flex-wrap gap-1">
                        {f.match.slice(0, 4).map((m) => (
                          <Badge key={m} tone="outline" className="font-data">{m}</Badge>
                        ))}
                        {f.match.length > 4 && <span className="text-2xs text-faint">+{f.match.length - 4}</span>}
                      </div>
                    </TD>
                    <TD><StatusChip tone={tone(f.status)} label={f.status} /></TD>
                    <TD className="pr-5 text-xs text-soft">{f.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {cfg.data?.disclaimer && (
        <p className="mt-4 text-2xs text-faint">{cfg.data.disclaimer}</p>
      )}

      {statuses.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Statuses</span>
          {statuses.map((s) => (
            <StatusChip key={s} tone={tone(s)} label={s} />
          ))}
        </div>
      )}
    </>
  );
}
