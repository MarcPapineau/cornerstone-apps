import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, UtensilsCrossed, Plus, Send, UserCog, Info, FileText, ArrowRight } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { Label, Input, Select, Textarea, FieldRow } from '../components/ui/Field.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { AddOnView } from '../components/addon/AddOnView.jsx';
import { TimelineRail } from '../components/dashboard/composers.jsx';
import { cn } from '../lib/utils.js';

// The request → review → approve journey shown when a client has asked for nothing yet, so the
// "My requests" panel communicates the flow instead of a bare line.
const ADDON_JOURNEY = [
  { label: 'Request', sub: 'Pick a plan & depth', state: 'active' },
  { label: 'Fee confirmed', sub: 'Practitioner reviews', state: 'pending' },
  { label: 'Approved', sub: 'Plan opens here', state: 'pending' },
];

/**
 * PortalAddOns — the client's "My Add-ons" surface. The client requests a supplement or
 * meal/diet plan; the request is created UNPAID and stays a DRAFT until their practitioner
 * confirms the fee, generates, attests and approves it. The SAME hard permission boundary as
 * every other portal surface holds: an un-approved add-on is NEVER returned as content — only
 * its lifecycle status. Approved plans render through the shared, presentational AddOnView,
 * the exact component the practitioner reviews, so the two can never drift. Educational
 * resource only — never a prescription.
 */

const CHOICES = [
  { type: 'SUPPLEMENT_PLAN', label: 'Supplement plan', icon: Pill, blurb: 'A supplement focus built around your protocol and, once available, your labs.' },
  { type: 'MEAL_PLAN', label: 'Meal / diet plan', icon: UtensilsCrossed, blurb: 'A nutrition plan matched to your goal — weekly, monthly meal-prep, or coaching depth.' },
];

const TYPE_LABEL = { SUPPLEMENT_PLAN: 'Supplement plan', MEAL_PLAN: 'Meal / diet plan' };

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function PortalAddOns() {
  const { clientId } = useRole();
  const q = useFetch(() => (clientId ? api.clientAddOns(clientId) : Promise.resolve(null)), [clientId]);

  const [requestType, setRequestType] = useState('');
  const [tier, setTier] = useState('');
  const [goals, setGoals] = useState('');
  const [allergies, setAllergies] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [meal, setMeal] = useState({});
  const setM = (k) => (e) => setMeal((m) => ({ ...m, [k]: e.target.value }));

  if (!clientId) {
    return (
      <>
        <PageHeader title="My Add-ons" description="Request a supplement or meal plan — your practitioner reviews and approves before you see it." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher to view their portal." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  if (q.loading) return <Loading label="Loading your add-ons…" />;
  if (q.error) return <ErrorState error={q.error} />;

  const requests = q.data?.requests || [];
  const approved = q.data?.approved || [];
  const tiers = q.data?.tiers || {};
  const tierList = (requestType && tiers[requestType]) || [];

  function pickType(type) {
    setRequestType(type);
    setTier('');
    setSaveErr(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (!requestType || !tier || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const baseIntake = { goals: splitList(goals), allergies: splitList(allergies), notes };
      const intake = requestType === 'MEAL_PLAN'
        ? {
            ...baseIntake,
            dislikes: splitList(meal.dislikes),
            dietaryStyle: meal.dietaryStyle || undefined,
            sex: meal.sex || undefined,
            age: meal.age ? Number(meal.age) : undefined,
            heightCm: meal.heightCm ? Number(meal.heightCm) : undefined,
            weightKg: meal.weightKg ? Number(meal.weightKg) : undefined,
            activityDaysPerWeek: meal.activityDays ? Number(meal.activityDays) : undefined,
            mealsPerDay: meal.mealsPerDay ? Number(meal.mealsPerDay) : undefined,
          }
        : baseIntake;
      await api.requestAddOn(clientId, { requestType, tier, intake, role: 'CLIENT' });
      setRequestType('');
      setTier('');
      setGoals('');
      setAllergies('');
      setNotes('');
      setMeal({});
      q.reload();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="My Add-ons"
        description="Request a supplement or meal plan. Your practitioner reviews and approves it before you see it — an educational resource, never a prescription."
      />

      <div className="space-y-5">
        {/* 1 — Request a plan */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Plus className="h-4 w-4 text-primary" /> Request a plan</CardTitle>
            <CardDescription>Choose what you'd like, then tell us a little about your goals. Your practitioner takes it from there.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CHOICES.map((c) => {
                const Icon = c.icon;
                const active = requestType === c.type;
                return (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => pickType(c.type)}
                    aria-pressed={active}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors',
                      active ? 'border-primary/40 bg-accent-soft ring-1 ring-primary/20' : 'border-border-soft hover:bg-muted',
                    )}
                  >
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-md', active ? 'bg-card text-primary' : 'bg-accent-soft text-primary')}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{c.label}</span>
                      <span className="mt-0.5 block text-2xs leading-relaxed text-soft">{c.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {requestType && (
              <form onSubmit={submit} className="space-y-3 border-t border-border-soft pt-4">
                <div>
                  <Label>Plan depth</Label>
                  <Select value={tier} onChange={(e) => setTier(e.target.value)}>
                    <option value="" disabled>Choose a {TYPE_LABEL[requestType].toLowerCase()} depth…</option>
                    {tierList.map((t) => (
                      <option key={t.key} value={t.key}>{`${t.label} (${t.feeLabel})`}</option>
                    ))}
                  </Select>
                  <p className="mt-1.5 flex items-start gap-1.5 text-2xs leading-relaxed text-faint">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Your practitioner confirms the add-on fee before it is prepared. Educational resource, not a prescription.
                  </p>
                </div>

                <div>
                  <Label>Goals</Label>
                  <Input value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="e.g. fat loss, recovery, sleep (comma-separated)" />
                </div>
                <div>
                  <Label>Allergies / things to avoid</Label>
                  <Input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="e.g. shellfish, dairy (comma-separated)" />
                </div>
                <div>
                  <Label>Notes / preferences</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else your practitioner should know — schedule, preferences, foods you love or avoid." />
                </div>

                {requestType === 'MEAL_PLAN' && (
                  <div className="space-y-3 rounded-lg border border-border-soft bg-muted/30 p-3">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Meal details (optional — helps estimate your targets)</div>
                    <FieldRow>
                      <div><Label>Sex</Label><Select value={meal.sex || ''} onChange={setM('sex')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option></Select></div>
                      <div><Label>Age</Label><Input type="number" value={meal.age || ''} onChange={setM('age')} placeholder="years" /></div>
                    </FieldRow>
                    <FieldRow>
                      <div><Label>Height</Label><Input type="number" value={meal.heightCm || ''} onChange={setM('heightCm')} placeholder="cm" /></div>
                      <div><Label>Weight</Label><Input type="number" step="0.1" value={meal.weightKg || ''} onChange={setM('weightKg')} placeholder="kg" /></div>
                    </FieldRow>
                    <FieldRow>
                      <div><Label>Training days / week</Label><Input type="number" value={meal.activityDays || ''} onChange={setM('activityDays')} placeholder="0–7" /></div>
                      <div><Label>Meals / day</Label><Input type="number" value={meal.mealsPerDay || ''} onChange={setM('mealsPerDay')} placeholder="e.g. 3" /></div>
                    </FieldRow>
                    <FieldRow>
                      <div><Label>Dietary style</Label><Select value={meal.dietaryStyle || ''} onChange={setM('dietaryStyle')}><option value="">No preference</option><option value="omnivore">Omnivore</option><option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option><option value="pescatarian">Pescatarian</option></Select></div>
                      <div><Label>Foods you dislike</Label><Input value={meal.dislikes || ''} onChange={setM('dislikes')} placeholder="e.g. liver, mushrooms (comma-separated)" /></div>
                    </FieldRow>
                  </div>
                )}

                {saveErr && <ErrorState error={saveErr} />}
                <Button type="submit" disabled={saving || !tier} className="w-full sm:w-auto">
                  <Send className="h-4 w-4" /> {saving ? 'Sending request…' : 'Send request'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* 2 — My requests */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              My requests {requests.length > 0 && <Badge tone="accent">{requests.length}</Badge>}
            </CardTitle>
            <CardDescription>The status of each plan you've asked for. The plan itself stays hidden until your practitioner approves it.</CardDescription>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <div className="space-y-3">
                <TimelineRail steps={ADDON_JOURNEY} />
                <p className="text-2xs text-faint">No requests yet — choose a plan above to get started. The plan itself stays hidden until your practitioner approves it.</p>
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Plan</TH>
                    <TH>Depth</TH>
                    <TH>Status</TH>
                    <TH>Fee</TH>
                  </TR>
                </THead>
                <TBody>
                  {requests.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium text-foreground">{TYPE_LABEL[r.requestType] || r.requestType}</TD>
                      <TD className="text-soft">{r.tier}</TD>
                      <TD><StatusChip status={r.status} /></TD>
                      <TD>{r.feeLabel ? <Badge>{r.feeLabel}</Badge> : <span className="text-2xs text-faint">—</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 3 — My approved plans */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              My approved plans {approved.length > 0 && <Badge tone="success">{approved.length}</Badge>}
            </CardTitle>
            <CardDescription>Plans your practitioner has reviewed and approved as an educational resource.</CardDescription>
          </CardHeader>
          <CardContent>
            {approved.length === 0 ? (
              <EmptyState
                title="No approved plans yet"
                hint="Anything in review stays hidden until your practitioner approves it."
                icon={Pill}
              />
            ) : (
              <div className="space-y-6">
                {approved.map((item) => {
                  // The document silo for the deep-link: SUPPLEMENT_PLAN → /document/supplement,
                  // MEAL_PLAN → /document/meal — both keyed by the approved add-on draft id.
                  const silo = item.addOnType === 'MEAL_PLAN' ? 'meal' : item.addOnType === 'SUPPLEMENT_PLAN' ? 'supplement' : null;
                  // Only link when the approved plan actually has rendered content; the client
                  // projection drops the raw plan, so a populated section list is the safe proxy
                  // that the server-side dossier will render (it 422s on a plan-less draft).
                  const hasPlan = (item.sections || []).length > 0;
                  return (
                    <div key={item.id || item.title} className="space-y-2">
                      {silo && hasPlan && item.id && (
                        <div className="flex justify-end">
                          <Link
                            to={`/document/${silo}/${encodeURIComponent(item.id)}?role=CLIENT`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border-soft px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:border-gold/40 hover:bg-muted/40"
                          >
                            <FileText className="h-3.5 w-3.5" /> View document <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      )}
                      <AddOnView addon={item} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
