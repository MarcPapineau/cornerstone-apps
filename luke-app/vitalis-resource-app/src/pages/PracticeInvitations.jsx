import { useState } from 'react';
import { Mail, Send, UserCog } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const EMPTY = { name: '', email: '', message: '' };

export default function PracticeInvitations() {
  const { practitionerId } = useRole();
  const q = useFetch(() => (practitionerId ? api.invitations(practitionerId) : Promise.resolve(null)), [practitionerId]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  if (!practitionerId) {
    return (
      <>
        <PageHeader title="Invite Clients" description="Send a client their own intake link." />
        <Card><CardContent className="py-10"><EmptyState title="No practitioner selected" hint="Pick a practitioner in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  if (q.loading) return <Loading label="Loading invitations…" />;
  if (q.error) return <ErrorState error={q.error} />;
  const invitations = q.data?.invitations || [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      await api.createInvitation({
        practitionerId,
        name: form.name,
        email: form.email,
        message: form.message,
        role: 'PRACTITIONER',
      });
      setForm(EMPTY);
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
        title="Invite Clients"
        description="Invitations let a client complete their own intake. The client never approves anything clinical — every clinical review stays with the practitioner."
        actions={<Badge tone="accent">{invitations.length} sent</Badge>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <Mail className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Invite a client</CardTitle>
              <CardDescription>Send a personal intake link. The client fills in their own profile — nothing clinical is decided on their side.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <FormField label="Name">
                <Input value={form.name} onChange={set('name')} placeholder="e.g. Pat R." required />
              </FormField>
              <FormField label="Email" hint="Where the intake link is sent. Optional — share the link manually if you prefer.">
                <Input type="email" value={form.email} onChange={set('email')} placeholder="pat@example.com" />
              </FormField>
              <FormField label="Message" hint="Optional note included with the invitation.">
                <Textarea value={form.message} onChange={set('message')} placeholder="Looking forward to reviewing your intake together." />
              </FormField>
              {saveErr && <ErrorState error={saveErr} />}
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={saving || !form.name.trim()}>
                  <Send className="h-4 w-4" />
                  {saving ? 'Sending…' : 'Send invitation'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Sent invitations</CardTitle>
            <CardDescription>Share the intake link with the client. They complete their own profile; you review everything afterward.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            {invitations.length === 0 ? (
              <EmptyState title="No invitations yet" hint="Invite the first client with the form on the left." icon={Mail} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="pl-5">Name / Email</TH>
                    <TH>Status</TH>
                    <TH>Sent</TH>
                    <TH className="pr-5">Intake link</TH>
                  </TR>
                </THead>
                <TBody>
                  {invitations.map((inv) => (
                    <TR key={inv.id}>
                      <TD className="pl-5">
                        <div className="font-medium text-foreground">{inv.name}</div>
                        <div className="mt-0.5 text-2xs text-faint">{inv.email || '—'}</div>
                      </TD>
                      <TD><StatusChip status={inv.status} /></TD>
                      <TD className="text-xs text-faint">{fmtDate(inv.createdAt)}</TD>
                      <TD className="pr-5">
                        <code className="font-data text-2xs">/portal/intake?token={inv.token}</code>
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
