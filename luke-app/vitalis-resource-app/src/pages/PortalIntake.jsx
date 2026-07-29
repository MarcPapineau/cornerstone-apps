import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, KeyRound, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FieldRow, FormField, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = { name: '', age: '', sex: '', weightKg: '', bodyFatPct: '', goals: '', allergies: '', products: '', notes: '' };

/**
 * PortalIntake — the client-facing onboarding surface ("Complete Your Intake"). A client
 * arrives via an invitation link (?token=) their practitioner sent, confirms the invite is
 * valid, and submits their own ClientProfile details. This page is purely presentational and
 * NEVER approves anything — it only records what the client tells us so their practitioner can
 * review it and prepare resources. Framed as an educational service throughout, never a request
 * for medical advice and never a prescription.
 */
export default function PortalIntake() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') || '');
  const [codeInput, setCodeInput] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const q = useFetch(() => (token ? api.invitation(token) : Promise.resolve(null)), [token]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      await api.submitIntake(token, {
        intake: {
          name: form.name,
          age: Number(form.age) || null,
          sex: form.sex,
          weightKg: Number(form.weightKg) || null,
          bodyFatPct: Number(form.bodyFatPct) || null,
          goals: splitList(form.goals),
          allergies: splitList(form.allergies),
          currentProducts: splitList(form.products),
          notes: form.notes,
        },
      });
      setSubmitted(true);
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  // No token yet — let the client paste the invitation code from their email.
  if (!token) {
    return (
      <>
        <PageHeader title="Complete your intake" description="Enter the invitation code your practitioner sent you to get started." />
        <Card className="mx-auto max-w-md">
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <KeyRound className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Enter your invitation code</CardTitle>
              <CardDescription>You’ll find this in the invitation your practitioner sent you.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (codeInput.trim()) setToken(codeInput.trim());
              }}
              className="space-y-4"
            >
              <FormField label="Invitation code">
                <Input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Paste your code" autoFocus />
              </FormField>
              <div className="flex items-center justify-end">
                <Button type="submit" disabled={!codeInput.trim()}>Continue</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </>
    );
  }

  if (q.loading) return <Loading label="Checking your invitation…" />;
  if (q.error) {
    return (
      <>
        <PageHeader title="Complete your intake" description="Let’s confirm your invitation." />
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="Invitation not found"
              hint="We couldn’t find this invitation. Double-check the code or ask your practitioner to resend your invite."
              icon={ClipboardList}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const invitation = q.data?.invitation || null;
  if (!invitation) {
    return (
      <>
        <PageHeader title="Complete your intake" description="Let’s confirm your invitation." />
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="Invitation not found"
              hint="We couldn’t find this invitation. Double-check the code or ask your practitioner to resend your invite."
              icon={ClipboardList}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  // Intake recorded — replace the form with a calm, resource-framed confirmation.
  if (submitted) {
    return (
      <>
        <PageHeader title="Complete your intake" description="Thanks for sharing your details." />
        <Card className="mx-auto max-w-xl">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-base font-medium text-foreground">Thank you — your intake is in.</p>
            <p className="max-w-md text-sm text-soft">
              Your practitioner will review it and prepare your resources. This is an educational service, not a request for medical advice.
            </p>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Complete your intake"
        description="Share a few details so your practitioner can review them and prepare your educational resources. Nothing here is medical advice."
      />

      <div className="mb-5 flex items-start gap-2 rounded-md border border-border-soft bg-neutral-soft px-3 py-2.5 text-xs text-soft">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>Invited by your practitioner. What you share here is reviewed by them to prepare educational resources — it is never a prescription or medical advice.</span>
      </div>

      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>Comma-separate any lists. Leave anything you’re unsure about blank — your practitioner will follow up.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <FormField label="Full name">
              <Input value={form.name} onChange={set('name')} placeholder="Your name" required />
            </FormField>
            <FieldRow>
              <FormField label="Age">
                <Input type="number" min="0" value={form.age} onChange={set('age')} placeholder="47" />
              </FormField>
              <FormField label="Sex">
                <Select value={form.sex} onChange={set('sex')}>
                  <option value="">Prefer not to say</option>
                  <option value="male">male</option>
                  <option value="female">female</option>
                  <option value="other">other</option>
                </Select>
              </FormField>
            </FieldRow>
            <FieldRow>
              <FormField label="Weight (kg)">
                <Input type="number" step="0.1" value={form.weightKg} onChange={set('weightKg')} placeholder="94" />
              </FormField>
              <FormField label="Body fat %">
                <Input type="number" step="0.1" value={form.bodyFatPct} onChange={set('bodyFatPct')} placeholder="24.5" />
              </FormField>
            </FieldRow>
            <FormField label="Goals" hint="Comma-separated. What you’re hoping to work on.">
              <Input value={form.goals} onChange={set('goals')} placeholder="Fat loss, Recovery, Energy" />
            </FormField>
            <FormField label="Allergies" hint="Comma-separated. Anything your practitioner should know about.">
              <Input value={form.allergies} onChange={set('allergies')} placeholder="None reported" />
            </FormField>
            <FormField label="Current products" hint="Comma-separated. Anything you’re currently taking.">
              <Input value={form.products} onChange={set('products')} placeholder="Retatrutide 10mg/vial, BPC-157 5mg/vial" />
            </FormField>
            <FormField label="Notes">
              <Textarea value={form.notes} onChange={set('notes')} placeholder="Anything else you’d like your practitioner to know." />
            </FormField>
            {saveErr && <ErrorState error={saveErr} />}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? 'Submitting…' : 'Submit intake'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
