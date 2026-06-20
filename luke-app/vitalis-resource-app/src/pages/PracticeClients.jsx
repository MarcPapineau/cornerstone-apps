import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, ArrowRight, UserCog, UserPlus } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Select, Textarea, FieldRow } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const EMPTY = { name: '', sex: '', age: '', goals: '', contraindications: '', currentProducts: '', notes: '' };
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function PracticeClients() {
  const { practitionerId } = useRole();
  const navigate = useNavigate();
  const roster = useFetch(() => (practitionerId ? api.practitionerClients(practitionerId) : Promise.resolve(null)), [practitionerId]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!practitionerId) {
    return (
      <>
        <PageHeader title="My Clients" description="Clients under this practice." />
        <Card><CardContent className="py-10"><EmptyState title="No practitioner selected" hint="Pick a practitioner in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  const clients = roster.data?.clients || [];

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true); setSaveErr(null);
    try {
      const res = await api.createClientForPractitioner(practitionerId, {
        name: form.name.trim(),
        sex: form.sex || null,
        age: form.age ? Number(form.age) : null,
        goals: splitList(form.goals),
        contraindications: splitList(form.contraindications),
        currentProducts: splitList(form.currentProducts),
        notes: form.notes,
      });
      setForm(EMPTY);
      roster.reload();
      const newId = res?.client?.id;
      if (newId) navigate(`/practice/clients/${newId}`);
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="My Clients"
        description="Every client that belongs to this practice. Ownership is single-sourced — a client you add here is assigned to your practice automatically."
        actions={<Badge tone="neutral">{clients.length} total</Badge>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-primary" /> Add a client</CardTitle><CardDescription>Created under your practice — never an orphan/global record.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <FormField label="Name"><Input value={form.name} onChange={set('name')} placeholder="Client name" required /></FormField>
              <FieldRow>
                <FormField label="Sex"><Select value={form.sex} onChange={set('sex')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></FormField>
                <FormField label="Age"><Input type="number" value={form.age} onChange={set('age')} placeholder="years" /></FormField>
              </FieldRow>
              <FormField label="Goals" hint="comma-separated"><Input value={form.goals} onChange={set('goals')} placeholder="e.g. fat loss, recovery" /></FormField>
              <FormField label="Contraindications" hint="comma-separated"><Input value={form.contraindications} onChange={set('contraindications')} placeholder="e.g. none reported" /></FormField>
              <FormField label="Current products" hint="comma-separated"><Input value={form.currentProducts} onChange={set('currentProducts')} placeholder="e.g. BPC-157 5mg/vial" /></FormField>
              <FormField label="Notes"><Textarea value={form.notes} onChange={set('notes')} placeholder="Intake notes" /></FormField>
              {saveErr && <ErrorState error={saveErr} />}
              <Button type="submit" disabled={saving || !form.name.trim()} className="w-full sm:w-auto"><UserPlus className="h-4 w-4" /> {saving ? 'Adding…' : 'Add client'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="px-0 pb-1 pt-1">
            {roster.loading ? <Loading /> : roster.error ? <ErrorState error={roster.error} /> : clients.length === 0 ? (
              <EmptyState title="No clients yet" hint="Add your first client with the form on the left." icon={Users} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent"><TH className="pl-5">Client</TH><TH>Sex / Age</TH><TH>Goals</TH><TH>Added</TH><TH className="pr-5"></TH></TR>
                </THead>
                <TBody>
                  {clients.map((c) => (
                    <TR key={c.id}>
                      <TD className="pl-5">
                        <Link to={`/practice/clients/${c.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{c.name}</Link>
                        {c._demo && <span className="ml-1.5 text-2xs text-faint">demo</span>}
                      </TD>
                      <TD className="text-xs">{[c.sex, c.age && `${c.age}y`].filter(Boolean).join(' · ') || '—'}</TD>
                      <TD className="text-xs">{(c.goals || []).slice(0, 3).join(', ') || <span className="text-faint">—</span>}</TD>
                      <TD className="text-xs text-faint">{fmtDate(c.createdAt)}</TD>
                      <TD className="pr-5 text-right"><Link to={`/practice/clients/${c.id}`} className="inline-flex text-faint hover:text-primary"><ArrowRight className="h-4 w-4" /></Link></TD>
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
