import { useState } from 'react';
import { UserPlus, Users, Trash2, Target } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtInt, fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FieldRow, FormField, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = { name: '', age: '', sex: '', weightKg: '', bodyFatPct: '', leanMassKg: '', goals: '', contraindications: '', currentProducts: '', notes: '' };

export default function Clients() {
  const { data, loading, error, reload } = useFetch(() => api.clients(), []);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const clients = data?.clients || [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      await api.createClient({
        name: form.name,
        age: form.age,
        sex: form.sex || null,
        weightKg: form.weightKg,
        bodyFatPct: form.bodyFatPct,
        leanMassKg: form.leanMassKg,
        goals: splitList(form.goals),
        contraindications: splitList(form.contraindications),
        currentProducts: splitList(form.currentProducts),
        notes: form.notes,
      });
      setForm(EMPTY);
      reload();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    await api.removeClient(id);
    reload();
  }

  return (
    <>
      <PageHeader
        title="Client Intake"
        description="Capture the ClientProfile that feeds the lab, research and draft gates. Goals and notes drive referral-category suggestions downstream — never a diagnosis."
        actions={<StatusChip tone="accent" label={`${fmtInt(clients.length)} on file`} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <UserPlus className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>New client</CardTitle>
              <CardDescription>Comma-separate lists. Blank fields stay UNKNOWN — never inferred.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <FormField label="Name">
                <Input value={form.name} onChange={set('name')} placeholder="e.g. Demo — Pat R." required />
              </FormField>
              <FieldRow>
                <FormField label="Age">
                  <Input type="number" min="0" value={form.age} onChange={set('age')} placeholder="47" />
                </FormField>
                <FormField label="Sex (never inferred)">
                  <Select value={form.sex} onChange={set('sex')}>
                    <option value="">Unspecified</option>
                    <option value="male">male</option>
                    <option value="female">female</option>
                    <option value="other">other</option>
                  </Select>
                </FormField>
              </FieldRow>
              <FieldRow className="sm:grid-cols-3">
                <FormField label="Weight (kg)">
                  <Input type="number" step="0.1" value={form.weightKg} onChange={set('weightKg')} placeholder="94" />
                </FormField>
                <FormField label="Body fat %">
                  <Input type="number" step="0.1" value={form.bodyFatPct} onChange={set('bodyFatPct')} placeholder="24.5" />
                </FormField>
                <FormField label="Lean mass (kg)">
                  <Input type="number" step="0.1" value={form.leanMassKg} onChange={set('leanMassKg')} placeholder="71" />
                </FormField>
              </FieldRow>
              <FormField label="Goals" hint="Comma-separated. Drives referral-category suggestions.">
                <Input value={form.goals} onChange={set('goals')} placeholder="Fat loss, Recovery, Energy" />
              </FormField>
              <FormField label="Contraindications">
                <Input value={form.contraindications} onChange={set('contraindications')} placeholder="None reported" />
              </FormField>
              <FormField label="Current products" hint="Comma-separated. Used to layer compound-specific lab monitoring.">
                <Input value={form.currentProducts} onChange={set('currentProducts')} placeholder="Retatrutide 10mg/vial, BPC-157 5mg/vial" />
              </FormField>
              <FormField label="Notes">
                <Textarea value={form.notes} onChange={set('notes')} placeholder="Context for the operator. Not clinical guidance." />
              </FormField>
              {saveErr && <ErrorState error={saveErr} />}
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Add client'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Client roster</CardTitle>
            <CardDescription>Demo records are clearly tagged. Removing a client does not delete their lab/outcome history rows.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            {loading ? (
              <Loading label="Loading clients…" />
            ) : error ? (
              <div className="px-5"><ErrorState error={error} /></div>
            ) : clients.length === 0 ? (
              <EmptyState title="No clients yet" hint="Add the first client with the form on the left." icon={Users} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="pl-5">Client</TH>
                    <TH>Goals</TH>
                    <TH>Composition</TH>
                    <TH>Added</TH>
                    <TH className="pr-5" />
                  </TR>
                </THead>
                <TBody>
                  {clients.map((c) => (
                    <TR key={c.id}>
                      <TD className="pl-5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{c.name}</span>
                          {c._demo && <Badge tone="warning">demo</Badge>}
                        </div>
                        <div className="mt-0.5 text-2xs text-faint">
                          {[c.sex, c.age != null ? `${c.age}y` : null].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {(c.goals || []).length === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            c.goals.slice(0, 3).map((g) => (
                              <Badge key={g} tone="neutral">
                                <Target className="h-3 w-3" /> {g}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TD>
                      <TD className="font-data text-xs">
                        {[c.weightKg != null ? `${c.weightKg}kg` : null, c.bodyFatPct != null ? `${c.bodyFatPct}%bf` : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TD>
                      <TD className="text-xs text-faint">{fmtDate(c.createdAt)}</TD>
                      <TD className="pr-5 text-right">
                        <Button variant="ghost" size="icon" onClick={() => remove(c.id)} title="Remove client" aria-label={`Remove ${c.name}`}>
                          <Trash2 className="h-4 w-4 text-faint" />
                        </Button>
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
