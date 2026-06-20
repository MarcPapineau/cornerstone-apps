import { useState, useEffect, useRef } from 'react';
import {
  MessagesSquare, Send, ShieldCheck, ShieldAlert, FileText, Sparkles, AlertTriangle,
  HelpCircle, FlaskConical, BadgeCheck, Save, Info, User,
  ClipboardCheck,
} from 'lucide-react';
import { useRole, ROLE_LABELS } from '../lib/roleContext.jsx';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Label, Input, Textarea } from '../components/ui/Field.jsx';
import { ErrorState } from '../components/ui/States.jsx';
import { BasisBlock } from '../components/protocol/BasisBlock.jsx';
import { DoseBlock } from '../components/protocol/DoseBlock.jsx';
import { AttestPanel } from '../components/protocol/AttestPanel.jsx';

/**
 * ProtocolChat — the in-app conversational protocol generator.
 *
 * The governance story in one line: **AI proposes, gates dispose.** A goal in plain
 * language is turned into candidate REAL catalog items; the output is then fed through the
 * exact same gate chain as the manual Draft Builder (catalog · route · research · compliance
 * · language · status), so it can never invent a product, a citation, a route, dodge Canadian
 * compliance, emit medical-claim language, or exceed DRAFT / resource-only.
 *
 * Role-aware (the two-tier liability model):
 *   PRACTITIONER / ADMIN → full DRAFT view: research-reported dosing + titration + taper,
 *     acknowledgment-gated "Save as DRAFT", attestation-gated approval (the only path to
 *     client-visible).
 *   CLIENT → softened, educational view: literature ranges + "review with your practitioner",
 *     NO personal schedule, NO persist (server-enforced 403).
 */

const LEVEL_TONE = { HIGH: 'success', MODERATE: 'accent', MEDIUM: 'accent', LOW: 'warning', EMERGING: 'warning', PRECLINICAL: 'warning', UNKNOWN: 'neutral' };
const COMP_TONE = { ALLOWED_RESOURCE: 'success', NEEDS_REVIEW: 'warning', BLOCKED: 'danger', UNKNOWN: 'neutral' };

const LICENSE_ACK_KEY = 'vitalis.licenseAck.v1';

const OPERATOR_EXAMPLES = ['Fat loss + recovery', 'Energy / mitochondrial', 'Heal a nagging tendon injury', 'Focus & sleep', 'Immune resilience'];
const CLIENT_EXAMPLES = ['Recovery & joint health', 'Energy and focus', 'Healthy aging', 'Sleep quality'];

const uid = () => Math.random().toString(36).slice(2, 9);

function bannerFor(d) {
  if (!d) return null;
  if (d.statusBanner) return d.statusBanner;
  if (d.blocked || d.status === 'BLOCKED') return 'BLOCKED — gate failure (see reasons)';
  if (d.status === 'APPROVED_RESOURCE') return 'APPROVED RESOURCE — reviewed · client-visible';
  return 'DRAFT — RESOURCE ONLY · NOT REVIEWED · NOT MEDICAL ADVICE';
}

function ItemRow({ it }) {
  return (
    <li className="rounded-md border border-border-soft p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{it.productName}</div>
          <div className="font-data text-2xs text-faint">
            {it.route || <span className="text-danger">UNKNOWN route</span>} · {it.form || 'UNKNOWN form'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {it.evidenceLevel
            ? <span className="inline-flex items-center gap-1.5">
                <StatusChip tone={LEVEL_TONE[it.evidenceLevel] || 'neutral'} label={it.evidenceLevel} />
                {it.citationCount != null && <span className="font-data text-2xs text-faint">{it.citationCount} cites</span>}
              </span>
            : <span className="text-2xs text-faint">evidence —</span>}
          {it.compliance?.status && <StatusChip tone={COMP_TONE[it.compliance.status] || 'neutral'} label={it.compliance.status} />}
        </div>
      </div>
      <BasisBlock basis={it.basis} />
      <DoseBlock dosing={it.dosing} />
    </li>
  );
}

// ── Licensed-use responsibility (the software-license acknowledgment) ─────────────────────
// Distinct from the per-protocol jurisdiction notice: a one-time acknowledgment that the
// operator owns their own due diligence + qualifications, and Vitalis only provides access
// to research/community-aggregated DRAFTs. Logged server-side; remembered locally for the
// demo session. It does NOT gate generation (the jurisdiction notice already does) — we are
// providing access, not assuming clinical responsibility.
function LicenseAckCard({ statement }) {
  const [ack, setAck] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LICENSE_ACK_KEY) || 'null'); } catch { return null; }
  });
  const [responsibility, setResponsibility] = useState(false);
  const [qualifications, setQualifications] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const ready = responsibility && qualifications;

  async function accept() {
    setSaving(true); setErr(null);
    try {
      const res = await api.licenseAck({ acceptedResponsibility: true, acceptedQualifications: true, role: 'PRACTITIONER' });
      const record = res.acknowledged || { acknowledgedAt: new Date().toISOString() };
      localStorage.setItem(LICENSE_ACK_KEY, JSON.stringify(record));
      setAck(record);
    } catch (e) { setErr(e); } finally { setSaving(false); }
  }

  if (ack) {
    return (
      <Card>
        <CardHeader><CardTitle>Licensed-use responsibility</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-2xs font-medium text-success">
            <ClipboardCheck className="h-3.5 w-3.5" /> Acknowledged
          </div>
          <p className="text-2xs leading-relaxed text-faint">
            You accepted responsibility for your own professional due diligence and qualifications
            {ack.acknowledgedAt ? ` on ${new Date(ack.acknowledgedAt).toLocaleDateString()}` : ''}. Vitalis provides
            access to the research; the decisions are yours.
          </p>
          <button
            type="button"
            onClick={() => { localStorage.removeItem(LICENSE_ACK_KEY); setAck(null); setResponsibility(false); setQualifications(false); }}
            className="text-2xs text-faint underline hover:text-soft"
          >
            Review again
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Licensed-use responsibility</CardTitle>
        <CardDescription>One-time acknowledgment for operators of this software.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <p className="text-2xs leading-relaxed text-soft">{statement || 'Loading…'}</p>
        <label className="flex cursor-pointer items-start gap-2 text-2xs text-soft">
          <input type="checkbox" checked={responsibility} onChange={(e) => setResponsibility(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[--ring]" />
          I accept responsibility for my own professional due diligence and use of this output.
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-2xs text-soft">
          <input type="checkbox" checked={qualifications} onChange={(e) => setQualifications(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[--ring]" />
          I am responsible for verifying my own qualifications to use this tool.
        </label>
        {err && <ErrorState error={err} />}
        <Button size="sm" onClick={accept} disabled={!ready || saving || !statement} className="w-full">
          {saving ? 'Recording…' : 'Acknowledge'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── One assistant turn: the gated protocol card ──────────────────────────────────────────
function ResultCard({ result, role, clientId, clientName }) {
  const [card, setCard] = useState(result);           // current result (updates after save/approve)
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showAttest, setShowAttest] = useState(false);
  const [err, setErr] = useState(null);

  const isOperator = role !== 'CLIENT';
  const draft = card.draft;
  const items = draft.items || [];
  const blocked = draft.blocked || draft.status === 'BLOCKED';
  const approved = draft.status === 'APPROVED_RESOURCE';
  const persisted = card.persisted || approved;
  const banner = bannerFor(draft);
  const bannerTone = blocked
    ? 'border-danger/30 bg-danger-soft text-danger'
    : approved
      ? 'border-success/25 bg-success-soft text-success'
      : 'border-warning/25 bg-warning-soft text-warning';

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await api.generateProtocol({
        goalText: card._goalText, role, jurisdiction: 'CA', clientId, persist: true, acknowledged: true,
      });
      setCard({ ...res, _goalText: card._goalText });
    } catch (e) { setErr(e); } finally { setSaving(false); }
  }

  async function approve({ name, comment }) {
    setApproving(true); setErr(null);
    try {
      const res = await api.reviewDraft(draft.id, {
        decision: 'APPROVE',
        reviewedBy: name || 'Dr. Vincent Lun',
        comment,
        attestation: { practitionerName: name || 'Dr. Vincent Lun', qualifiedPeptideLiterate: true, reviewedBasis: true },
      });
      setCard((c) => ({ ...c, draft: res.draft }));
      setShowAttest(false);
    } catch (e) { setErr(e); } finally { setApproving(false); }
  }

  // No items proposed → surface the reasoning honestly, no card chrome.
  if (card.empty || items.length === 0) {
    return (
      <div className="rounded-lg border border-border-soft bg-card p-4 shadow-card">
        <div className="flex items-center gap-2 text-xs font-medium text-soft">
          <Info className="h-4 w-4 text-faint" /> No catalog items matched that goal.
        </div>
        {(card.reasoning || []).length > 0 && (
          <ul className="mt-2 space-y-1 text-2xs text-faint">{card.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ul>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle>{draft.title || 'Generated DRAFT resource'}</CardTitle>
            <span className="font-data text-2xs text-faint">{draft.id}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone="accent"><Sparkles className="h-3 w-3" /> {card.proposerSource || 'deterministic'}</Badge>
            <StatusChip status={draft.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${bannerTone}`}>
          {blocked ? <ShieldAlert className="h-4 w-4" /> : approved ? <BadgeCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {banner}
        </div>

        {(card.matchedGoals || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Matched goals</span>
            {card.matchedGoals.map((g) => <Badge key={g.category} tone="neutral">{g.label}</Badge>)}
          </div>
        )}

        <ul className="space-y-2">
          {items.map((it, i) => <ItemRow key={it.productId || i} it={it} />)}
        </ul>

        {/* One protocol-level attribution line for operators (replaces per-item hedging). */}
        {isOperator && (
          <p className="text-2xs leading-relaxed text-faint">
            Attributed reportage — clinical studies where they exist, community practice where they don't. This is a
            DRAFT / resource-only surface, not a Vitalis claim or a guarantee of outcomes; the clinical decision is yours.
          </p>
        )}

        {draft.compliance && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-2xs font-semibold uppercase tracking-wide text-faint">Overall compliance</span>
            <StatusChip tone={COMP_TONE[draft.compliance.status] || 'neutral'} label={`${draft.compliance.jurisdiction} · ${draft.compliance.status}`} />
            {draft.compliance.reason && <span className="text-soft">{draft.compliance.reason}</span>}
          </div>
        )}

        {(draft.blockedReasons || []).length > 0 && (
          <div className="rounded-md border border-danger/20 bg-danger-soft p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-danger"><ShieldAlert className="h-3.5 w-3.5" /> Blocked reasons</div>
            <ul className="space-y-0.5 text-xs text-danger">{draft.blockedReasons.map((r, i) => <li key={i}>· {r}</li>)}</ul>
          </div>
        )}
        {(draft.warnings || []).length > 0 && (
          <div className="rounded-md border border-warning/25 bg-warning-soft p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Warnings</div>
            <ul className="space-y-0.5 text-xs text-warning">{draft.warnings.map((r, i) => <li key={i}>· {r}</li>)}</ul>
          </div>
        )}
        {(draft.unknowns || []).length > 0 && (
          <div className="rounded-md border border-border-soft bg-muted/40 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint"><HelpCircle className="h-3.5 w-3.5" /> Unknowns</div>
            <ul className="space-y-0.5 text-xs text-soft">{draft.unknowns.map((r, i) => <li key={i}>· {r}</li>)}</ul>
          </div>
        )}
        {(draft.labsSuggested || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-faint"><FlaskConical className="h-3.5 w-3.5" /> Labs suggested</span>
            {draft.labsSuggested.map((l) => <Badge key={l} tone="neutral" className="font-data">{l}</Badge>)}
          </div>
        )}

        {(card.reasoning || []).length > 0 && (
          <details className="group rounded-md border border-border-soft">
            <summary className="cursor-pointer list-none px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-faint hover:text-soft">
              Why these items <span className="font-normal normal-case">— the proposer's reasoning trail</span>
            </summary>
            <ul className="space-y-1 px-3 pb-2.5 text-2xs text-soft">{card.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        )}

        {/* Client view: educational close — never an action that mints clinical state. */}
        {!isOperator && (
          <div className="rounded-md border border-primary/15 bg-accent-soft px-3 py-2 text-xs text-soft">
            <span className="font-medium text-primary">Review this with your practitioner.</span> These are research ranges from the
            literature, not a personal prescription. Your practitioner determines whether — and how — anything here applies to you.
          </div>
        )}

        {/* Operator view: acknowledgment-gated save → attestation-gated approval. */}
        {isOperator && (
          <div className="space-y-3 border-t border-border-soft pt-3">
            {err && <ErrorState error={err} />}
            {!persisted ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs text-faint">
                  Saving attaches this DRAFT to <span className="font-medium text-soft">{clientName || 'the selected client'}</span> for review.
                  It stays resource-only until a practitioner attests and approves.
                </p>
                <Button size="sm" variant="outline" onClick={save} disabled={saving || blocked || !clientId}>
                  <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save as DRAFT'}
                </Button>
              </div>
            ) : approved ? (
              <div className="flex items-center gap-2 text-2xs text-success">
                <BadgeCheck className="h-4 w-4" /> Approved by {draft.reviewedBy} — now visible in the client portal as a resource.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-success"><Save className="h-3.5 w-3.5" /> Saved as DRAFT · {draft.id}</span>
                  {!showAttest && (
                    <Button size="sm" onClick={() => setShowAttest(true)} disabled={blocked}>
                      Review & approve
                    </Button>
                  )}
                </div>
                {showAttest && <AttestPanel defaultName="Dr. Vincent Lun" onApprove={approve} approving={approving} err={null} />}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProtocolChat() {
  const { role, clientId: roleClientId } = useRole();
  const isOperator = role !== 'CLIENT';

  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState(null);
  const [disclaimer, setDisclaimer] = useState(null);
  const [licenseStatement, setLicenseStatement] = useState(null);
  const [targetClientId, setTargetClientId] = useState(isOperator ? (roleClientId || '') : '');
  const [clientName, setClientName] = useState('');

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  // Fetch the jurisdiction notice once (role-aware). Generating with an empty goal returns no
  // items but carries the canonical notice text — so the gate copy never drifts from the server.
  useEffect(() => {
    let alive = true;
    api.generateProtocol({ goalText: '', role, jurisdiction: 'CA', persist: false })
      .then((res) => { if (alive) { setNotice(res.jurisdictionNotice); setDisclaimer(res.disclaimer); setLicenseStatement(res.licenseNotice?.statement || null); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [role]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(goalText) {
    const text = (goalText ?? input).trim();
    if (!text || busy || !acknowledged) return;
    setInput('');
    setMessages((m) => [...m, { id: uid(), from: 'user', text }]);
    setBusy(true);
    try {
      const res = await api.generateProtocol({
        goalText: text, role, jurisdiction: 'CA',
        clientId: isOperator ? targetClientId : undefined,
        persist: false, acknowledged,
      });
      res._goalText = text;
      setMessages((m) => [...m, { id: uid(), from: 'assistant', result: res }]);
    } catch (e) {
      setMessages((m) => [...m, { id: uid(), from: 'assistant', error: e }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const examples = isOperator ? OPERATOR_EXAMPLES : CLIENT_EXAMPLES;

  return (
    <>
      <PageHeader
        title="Protocol Generator"
        description="Describe a goal in plain language. The generator proposes real catalog items — then every clinical boundary is enforced by the same gates as the Draft Builder. Output is always a DRAFT / resource-only, never a prescription."
        actions={<StatusChip tone="accent" label="AI proposes · gates dispose" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Chat column */}
        <div className="flex flex-col lg:col-span-2">
          <Card className="flex min-h-[60vh] flex-col">
            <CardHeader className="border-b border-border-soft">
              <div className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4 text-primary" />
                <CardTitle>{isOperator ? 'Generate a protocol' : 'Explore the research'}</CardTitle>
              </div>
              <CardDescription>
                {isOperator
                  ? 'Practitioner view — full research-reported dosing. Saving + approval are gated and logged.'
                  : 'Educational view — literature ranges only. Anything specific to you is decided with your practitioner.'}
              </CardDescription>
            </CardHeader>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto scrollbar-thin px-5 py-4">
              {/* Always-visible framing */}
              <div className="rounded-md border border-border-soft bg-muted/40 px-3 py-2 text-2xs text-soft">
                <span className="font-semibold uppercase tracking-wide text-faint">How this stays safe — </span>
                the generator only chooses which <em>real</em> catalog items to consider. It can't invent a product, a citation, or a
                route, can't dodge Canadian compliance, and can't mint anything past DRAFT. Each item is shown two honest ways:
                <em> what the studies show</em> where trials exist, and <em>what the greater community does</em> where they don't —
                attributed reportage, never an instruction or a Vitalis claim.
              </div>

              {messages.length === 0 && (
                <div className="space-y-2 py-2">
                  <p className="text-xs text-faint">Try a goal:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => acknowledged && send(ex)}
                        disabled={!acknowledged}
                        className="rounded-full border border-border-soft bg-card px-3 py-1 text-2xs text-soft transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                m.from === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="flex max-w-[85%] items-start gap-2">
                      <div className="rounded-lg rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{m.text}</div>
                      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary"><User className="h-3.5 w-3.5" /></span>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div className="w-full max-w-[95%]">
                      {m.error
                        ? <ErrorState error={m.error} />
                        : <ResultCard result={m.result} role={role} clientId={targetClientId} clientName={clientName} />}
                    </div>
                  </div>
                )
              ))}

              {busy && (
                <div className="flex items-center gap-2 text-xs text-faint">
                  <Sparkles className="h-4 w-4 animate-pulse text-primary" /> Proposing items, then running every gate…
                </div>
              )}
            </div>

            {/* Composer (gated behind the jurisdiction acknowledgment) */}
            <div className="border-t border-border-soft p-3">
              {!acknowledged ? (
                <div className="rounded-md border border-warning/25 bg-warning-soft p-3">
                  <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-warning">
                    <ShieldCheck className="h-3.5 w-3.5" /> {notice?.label || 'Canada'} — acknowledge to continue
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-soft">{notice?.notice || 'Loading notice…'}</p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <p className="max-w-md text-2xs text-faint">{notice?.acceptLabel}</p>
                    <Button size="sm" onClick={() => setAcknowledged(true)} disabled={!notice}>I understand — continue</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    placeholder={isOperator ? 'Describe a goal (e.g. "fat loss + recovery")…' : 'What are you researching? (e.g. "recovery", "energy")…'}
                    className="min-h-[40px] resize-none"
                  />
                  <Button onClick={() => send()} disabled={busy || !input.trim()} className="shrink-0">
                    <Send className="h-4 w-4" /> Send
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Context rail */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>You are operating as</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <StatusChip tone={isOperator ? 'accent' : 'neutral'} label={ROLE_LABELS[role] || role} />
              <p className="text-2xs text-faint">
                {isOperator
                  ? 'Practitioners and admins see the full DRAFT — research-reported dosing, titration and taper — and control saving + approval.'
                  : 'Clients see literature ranges framed for discussion with a practitioner. No personal schedule, and nothing can be saved or approved here.'}
              </p>
            </CardContent>
          </Card>

          {isOperator && <LicenseAckCard statement={licenseStatement} />}

          {isOperator && (
            <Card>
              <CardHeader>
                <CardTitle>Save target</CardTitle>
                <CardDescription>A saved DRAFT attaches to this client for review.</CardDescription>
              </CardHeader>
              <CardContent>
                <ClientPicker
                  value={targetClientId}
                  onChange={(id) => {
                    setTargetClientId(id);
                    api.clients().then((d) => setClientName((d.clients || []).find((c) => c.id === id)?.name || '')).catch(() => {});
                  }}
                  autoSelectFirst
                  hint="Server-enforced: only an approved DRAFT becomes client-visible."
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>The six liability levers</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-2xs text-soft">
                <li className="flex gap-1.5"><span className="text-faint">1.</span> Attribution, not instruction — studies where they exist, community practice where they don't.</li>
                <li className="flex gap-1.5"><span className="text-faint">2.</span> Source-locked — every number is curated or flagged UNKNOWN.</li>
                <li className="flex gap-1.5"><span className="text-faint">3.</span> Practitioner-mediated — a specific dose only after approval.</li>
                <li className="flex gap-1.5"><span className="text-faint">4.</span> Attestation — approving requires a qualified attestation, logged.</li>
                <li className="flex gap-1.5"><span className="text-faint">5.</span> Two-tier — practitioner sees the DRAFT, client sees ranges.</li>
                <li className="flex gap-1.5"><span className="text-faint">6.</span> Jurisdiction — Canadian research service, click-accepted.</li>
              </ul>
            </CardContent>
          </Card>

          {disclaimer && (
            <p className="px-1 text-2xs leading-relaxed text-faint">{disclaimer}</p>
          )}
        </div>
      </div>
    </>
  );
}
