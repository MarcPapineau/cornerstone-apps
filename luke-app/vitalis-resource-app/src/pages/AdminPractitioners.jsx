import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, UserPlus, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtInt } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Select, FieldRow } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const ACCESS = ['ACTIVE', 'SUSPENDED', 'INVITED', 'PENDING_REVIEW'];
const ACCESS_TONE = { ACTIVE: 'success', SUSPENDED: 'danger', INVITED: 'accent', PENDING_REVIEW: 'warning' };
const PLANS = ['free', 'plus', 'pro'];
const EMPTY = { name: '', discipline: '', credentials: '', planLevel: 'free' };

export default function AdminPractitioners() {
  const ov = useFetch(() => api.adminOverview(), []);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const rows = ov.data?.perPractitioner || [];

  async function create(e) {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true); setErr(null);
    try { await api.createPractitioner({ ...form, name: form.name.trim() }); setForm(EMPTY); ov.reload(); }
    catch (e2) { setErr(e2); } finally { setSaving(false); }
  }

  async function patch(id, body) {
    setBusyId(id);
    try { await api.updatePractitioner(id, body); ov.reload(); }
    catch (e2) { setErr(e2); } finally { setBusyId(null); }
  }

  return (
    <>
      <PageHeader
        title="Practitioners / Providers"
        description="Create provider accounts, set access status and plan, and toggle client-portal access. Each provider sees only their own clients."
        actions={<Badge tone="accent"><Stethoscope className="h-3 w-3" /> {fmtInt(rows.length)} providers</Badge>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-primary" /> Create provider</CardTitle><CardDescription>New providers start ACTIVE with portal access on.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3">
              <FormField label="Name"><Input value={form.name} onChange={set('name')} placeholder="Dr. …" required /></FormField>
              <FieldRow>
                <FormField label="Discipline"><Input value={form.discipline} onChange={set('discipline')} placeholder="e.g. Naturopath" /></FormField>
                <FormField label="Credentials"><Input value={form.credentials} onChange={set('credentials')} placeholder="e.g. ND" /></FormField>
              </FieldRow>
              <FormField label="Plan"><Select value={form.planLevel} onChange={set('planLevel')}>{PLANS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}</Select></FormField>
              {err && <ErrorState error={err} />}
              <Button type="submit" disabled={saving || !form.name.trim()}><UserPlus className="h-4 w-4" /> {saving ? 'Creating…' : 'Create provider'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="px-0 pb-1 pt-1">
            {ov.loading ? <Loading /> : ov.error ? <ErrorState error={ov.error} /> : rows.length === 0 ? (
              <EmptyState title="No providers yet" hint="Create one with the form." icon={Stethoscope} />
            ) : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH className="pl-5">Provider</TH><TH>Access</TH><TH>Plan</TH><TH>Clients</TH><TH>Pending</TH><TH className="pr-5">Portal</TH></TR></THead>
                <TBody>
                  {rows.map((p) => (
                    <TR key={p.id}>
                      <TD className="pl-5">
                        <Link to={`/admin/practitioners/${p.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{p.name}</Link>
                        {p.practitionerType === 'OWNER' && <Badge tone="accent" className="ml-1.5">Owner</Badge>}
                        <div className="text-2xs text-faint">{p.discipline || '—'}</div>
                      </TD>
                      <TD>
                        <Select value={p.accessStatus} disabled={busyId === p.id} onChange={(e) => patch(p.id, { accessStatus: e.target.value })} className="h-7 py-0 text-2xs">
                          {ACCESS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      </TD>
                      <TD>
                        <Select value={p.planLevel} disabled={busyId === p.id} onChange={(e) => patch(p.id, { planLevel: e.target.value })} className="h-7 py-0 text-2xs">
                          {PLANS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                        </Select>
                      </TD>
                      <TD className="font-data text-sm">{fmtInt(p.clientCount)}</TD>
                      <TD className="font-data text-sm">{p.pendingReviews ? <span className="text-warning">{fmtInt(p.pendingReviews)}</span> : '0'}</TD>
                      <TD className="pr-5">
                        <button type="button" disabled={busyId === p.id} onClick={() => patch(p.id, { portalAccessEnabled: !p.portalAccessEnabled })} className="inline-flex items-center gap-1 text-2xs font-medium">
                          {p.portalAccessEnabled ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> On</span> : <span className="inline-flex items-center gap-1 text-faint"><XCircle className="h-3.5 w-3.5" /> Off</span>}
                        </button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
