import { useState } from 'react';
import { ScrollText, History, Layers, UserCog, Sparkles, Send, Hourglass, BadgeCheck, CalendarClock } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { Card, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Label, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { SectionHeader } from '../components/ui/SectionHeader.jsx';
import { CurrentProtocolCard, PastProtocolCard, ProtocolTimeline } from '../components/protocol/ProtocolViews.jsx';
import PeptideProtocolDocument from '../components/document/PeptideProtocolDocument.jsx';
import { DashboardHero, StatusRibbon, TimelineRail } from '../components/dashboard/composers.jsx';

// The request → review → approve journey shown in the empty state so a client with no protocol
// still sees where they are and what happens next (never a blank box).
const PROTOCOL_JOURNEY = [
  { label: 'Request', sub: 'Tell us your goal', state: 'active' },
  { label: 'Practitioner review', sub: 'Built & checked', state: 'pending' },
  { label: 'Approved', sub: 'Appears here', state: 'pending' },
];

const REQ_TONE = { 'Awaiting review': 'warning', 'Changes requested': 'warning', Approved: 'success', 'Needs attention': 'danger' };

/** Render an APPROVED current protocol as the full Vitalis dossier (server-built, client-gated). */
function CurrentProtocolDocument({ protocol }) {
  const docQ = useFetch(() => api.document('peptide', protocol.id, 'CLIENT'), [protocol.id]);
  if (docQ.loading) return <Loading label="Rendering your protocol document…" />;
  if (docQ.error || !docQ.data?.document) return <CurrentProtocolCard p={protocol} />;
  return <PeptideProtocolDocument doc={docQ.data.document} />;
}

/**
 * PortalProtocols — the client's Peptide Protocols silo. Leads with the APPROVED protocol rendered
 * as a Vitalis dossier (drafts physically cannot appear — the projection is APPROVED-only and the
 * document endpoint 403s anything else). The request action is a compact disclosure at the BOTTOM,
 * never above the protocol.
 */
export default function PortalProtocols() {
  const { clientId } = useRole();
  const protoQ = useFetch(() => (clientId ? api.clientProtocols(clientId) : Promise.resolve(null)), [clientId]);
  const entQ = useFetch(() => (clientId ? api.clientEntitlements(clientId) : Promise.resolve(null)), [clientId]);
  const reqQ = useFetch(() => (clientId ? api.clientProtocolRequests(clientId) : Promise.resolve(null)), [clientId]);

  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);
  const [notice, setNotice] = useState(null);

  if (!clientId) {
    return <Card><CardContent className="py-12"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher." icon={UserCog} /></CardContent></Card>;
  }
  if (protoQ.loading) return <Loading label="Loading your protocols…" />;
  if (protoQ.error) return <ErrorState error={protoQ.error} />;

  const current = protoQ.data?.current || [];
  const past = protoQ.data?.past || [];
  const timeline = protoQ.data?.timeline || [];
  const disclaimer = protoQ.data?.disclaimer;
  const total = current.length + past.length;

  const ent = entQ.data?.entitlement || {};
  const plan = entQ.data?.plan || {};
  const included = ent.includedProtocolCredits ?? plan.includedProtocolCredits ?? null;
  const used = ent.usedThisMonth ?? 0;
  const remaining = included == null ? null : Math.max(0, included - used);
  const perFee = ent.perProtocolFee ?? plan.perProtocolFee ?? 0;
  const requests = reqQ.data?.requests || [];

  async function submit(e) {
    e.preventDefault();
    if (!goal.trim() || submitting) return;
    setSubmitting(true); setSubmitErr(null); setNotice(null);
    try {
      const res = await api.requestProtocol(clientId, { goalText: goal.trim() });
      if (res.empty) setNotice(res.message);
      else { setNotice('Request submitted — your practitioner will review and approve a protocol for you.'); setGoal(''); reqQ.reload(); entQ.reload(); }
    } catch (err) { setSubmitErr(err); } finally { setSubmitting(false); }
  }

  const RequestDisclosure = (
    <details className="group rounded-xl border border-border bg-card shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3.5 text-sm font-semibold text-foreground">
        <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold" /> Request a new protocol</span>
        <span className="text-2xs font-normal text-faint">{included == null ? 'Unlimited included' : `${remaining}/${included} included${remaining === 0 ? ` · $${perFee} overage` : ''}`}</span>
      </summary>
      <div className="border-t border-border-soft px-5 py-4">
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Your goal</Label><Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. fat loss and recovery, energy and focus, healthy aging…" /></div>
          <div className="flex items-center justify-end"><Button type="submit" disabled={submitting || !goal.trim()}><Send className="h-4 w-4" /> {submitting ? 'Submitting…' : 'Request protocol'}</Button></div>
          {notice && <p className="rounded-md border border-success/20 bg-success-soft px-3 py-2 text-xs text-success">{notice}</p>}
          {submitErr && <ErrorState error={submitErr} />}
        </form>
        <p className="mt-2 text-2xs text-faint">Your practitioner reviews and approves every protocol before you see it — nothing is final until then.</p>
      </div>
    </details>
  );

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="My Vitalis Health" title="My Peptide Protocols" icon={ScrollText}
        subtitle="Your practitioner-approved protocols, rendered as Vitalis dossiers. Drafts in progress are never shown — you’ll see a protocol the moment it’s approved."
        ribbons={<StatusRibbon tone="success" icon={BadgeCheck}>{total} approved</StatusRibbon>}
      />

      {total === 0 ? (
        <>
          <section className="space-y-3">
            <SectionHeader eyebrow="How it works" title="Your protocol journey" sub="Where you are and what happens next. Drafts in progress are never shown here." />
            <TimelineRail steps={requests.length ? PROTOCOL_JOURNEY.map((s, i) => (i === 1 ? { ...s, state: 'active' } : i === 0 ? { ...s, state: 'done' } : s)) : PROTOCOL_JOURNEY} />
          </section>
          <Card><CardContent className="py-12"><EmptyState title="Nothing approved yet" hint="Request a protocol below — drafts in progress are never shown here." icon={ScrollText} /></CardContent></Card>
          {RequestDisclosure}
        </>
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeader eyebrow="Active" title="Current protocol" />
            {current.length === 0
              ? <Card><CardContent className="py-8"><EmptyState title="No active protocol" hint="You don’t have an active protocol right now. Past protocols are below." icon={Layers} /></CardContent></Card>
              : <div className="space-y-6">{current.map((p) => <CurrentProtocolDocument key={p.id} protocol={p} />)}</div>}
          </section>

          {past.length > 0 && (
            <section className="space-y-3">
              <SectionHeader eyebrow="History" title="Past protocols" />
              <div className="space-y-4">{past.map((p) => <PastProtocolCard key={p.id} p={p} />)}</div>
            </section>
          )}

          {requests.length > 0 && (
            <section className="space-y-3">
              <SectionHeader eyebrow="Tracking" title="My requests" sub="The protocol itself stays hidden until your practitioner approves it." />
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
                {requests.map((r, i) => (
                  <div key={r.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                    <span className="min-w-0 truncate text-sm text-foreground"><Hourglass className="mr-1.5 inline h-3.5 w-3.5 text-faint" />{r.goal || 'Protocol request'}</span>
                    <StatusRibbon tone={REQ_TONE[r.statusLabel] || 'ink'}>{r.statusLabel}</StatusRibbon>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <SectionHeader eyebrow="Activity" title="Protocol timeline" actions={<span className="inline-flex items-center gap-1 text-2xs text-faint"><CalendarClock className="h-3.5 w-3.5" /> {timeline.length} events</span>} />
            <Card><CardContent className="pt-4"><ProtocolTimeline events={timeline} /></CardContent></Card>
          </section>

          {RequestDisclosure}
        </>
      )}

      {disclaimer && <p className="text-2xs leading-relaxed text-faint">{disclaimer}</p>}
    </div>
  );
}
