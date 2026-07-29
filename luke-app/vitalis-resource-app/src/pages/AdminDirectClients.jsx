import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCircle2, ShieldCheck, UserPlus } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Select, FieldRow } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const EMPTY = { name: '', sex: '', age: '', goals: '', currentProducts: '' };
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * AdminDirectClients — direct-to-consumer clients owned by a Vitalis OWNER provider (never
 * orphan/global). Admin can create a direct client here; it is assigned to the owner provider,
 * so its protocol/add-on drafts flow into the owner's review queue exactly like any tenant.
 */
export default function AdminDirectClients() {
  const q = useFetch(() => api.adminDirectClients(), []);
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (q.loading) return <Loading label="Loading direct clients…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const owners = q.data?.owners || [];
  const clients = q.data?.clients || [];
  const owner = owners.find((o) => o.directClientOwner) || owners[0] || null;

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !owner || saving) return;
    setSaving(true); setSaveErr(null);
    try {
      const res = await api.createClientForPractitioner(owner.id, {
        name: form.name.trim(), sex: form.sex || null, age: form.age ? Number(form.age) : null,
        goals: splitList(form.goals), currentProducts: splitList(form.currentProducts),
      });
      setForm(EMPTY); q.reload();
      const newId = res?.client?.id;
      if (newId) navigate(`/practice/clients/${newId}`);
    } catch (err) { setSaveErr(err); } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="Direct Clients"
        description="Direct-to-consumer clients owned by a Vitalis owner-provider profile — never an orphan/global record."
        actions={<Badge tone="accent"><UserCircle2 className="h-3 w-3" /> {clients.length} direct</Badge>}
      />

      {owner && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-primary/15 bg-accent-soft px-3 py-2.5 text-xs text-soft">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span><span className="font-medium text-foreground">{owner.name}</span> is the owner provider. New direct clients are assigned to this profile and their drafts flow into its review queue — Vitalis operates as the provider.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-primary" /> Add a direct client</CardTitle><CardDescription>Created under the Vitalis owner provider — opens their dossier.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <FormField label="Name"><Input value={form.name} onChange={set('name')} placeholder="Client name" required /></FormField>
              <FieldRow>
                <FormField label="Sex"><Select value={form.sex} onChange={set('sex')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></FormField>
                <FormField label="Age"><Input type="number" value={form.age} onChange={set('age')} placeholder="years" /></FormField>
              </FieldRow>
              <FormField label="Goals" hint="comma-separated"><Input value={form.goals} onChange={set('goals')} placeholder="e.g. fat loss, recovery" /></FormField>
              <FormField label="Current products" hint="comma-separated"><Input value={form.currentProducts} onChange={set('currentProducts')} placeholder="e.g. BPC-157 5mg/vial" /></FormField>
              {saveErr && <ErrorState error={saveErr} />}
              <Button type="submit" disabled={saving || !form.name.trim() || !owner}><UserPlus className="h-4 w-4" /> {saving ? 'Adding…' : 'Add direct client'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="px-0 pb-1 pt-1">
            {clients.length === 0 ? (
              <EmptyState title="No direct clients yet" hint="Add a direct-to-consumer client with the form." icon={UserCircle2} />
            ) : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH className="pl-5">Client</TH><TH>Owner</TH><TH>Goals</TH><TH className="pr-5">Added</TH></TR></THead>
                <TBody>
                  {clients.map((c) => (
                    <TR key={c.id}>
                      <TD className="pl-5 font-medium text-foreground">{c.name}{c._demo && <span className="ml-1.5 text-2xs text-faint">demo</span>}</TD>
                      <TD className="text-xs text-soft">{c.ownerName || '—'}</TD>
                      <TD className="text-xs">{(c.goals || []).slice(0, 3).join(', ') || <span className="text-faint">—</span>}</TD>
                      <TD className="pr-5 text-xs text-faint">{fmtDate(c.createdAt)}</TD>
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
