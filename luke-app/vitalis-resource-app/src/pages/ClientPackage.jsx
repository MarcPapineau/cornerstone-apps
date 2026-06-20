import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package, Sparkles, ShieldCheck, ShieldAlert, BadgeCheck, Save, Info, RotateCcw, Lock,
} from 'lucide-react';
import { useRole, ROLE_LABELS } from '../lib/roleContext.jsx';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Label, Textarea } from '../components/ui/Field.jsx';
import { ErrorState } from '../components/ui/States.jsx';
import { PackageView } from '../components/package/PackageView.jsx';
import { AttestPanel } from '../components/protocol/AttestPanel.jsx';

/**
 * ClientPackage — the ONE-CLICK Client Package builder (practitioner / admin).
 *
 * Marc's workflow, in the app: a client states a goal → one action generates a gated protocol
 * DRAFT, attaches it to the client's record, and presents it as a 3-facet bundle — Protocol +
 * Bloodwork to order + Nutrition follow-up. The practitioner attests + approves, and it becomes
 * the client's portal package (swappable later through the same current/past lifecycle).
 *
 * Reuses everything already built: the generator (AI proposes, gates dispose), the composer
 * (composeClientPackage), the canonical PackageView + AttestPanel. It mints nothing new — it
 * sequences the existing gated steps into a single generate → save → approve → publish action.
 *
 *   GENERATE  → api.generateProtocol(persist:true, acknowledged:true) — a DRAFT on the record.
 *   COMPOSE   → api.packageForDraft(draftId) — the operator preview (full dosing + rationale).
 *   APPROVE   → api.reviewDraft(APPROVE + attestation) — the ONLY path to client-visible.
 *
 * Server-authoritative throughout: the browser never decides; output is always DRAFT /
 * resource-only until a practitioner attests. Not a prescription, not a diagnosis.
 */

const EXAMPLES = ['Fat loss + recovery', 'Energy / mitochondrial', 'Heal a nagging tendon injury', 'Focus & sleep', 'Healthy aging'];

export default function ClientPackage() {
  const { role, clientId: roleClientId } = useRole();
  const [searchParams] = useSearchParams();
  const presetClient = searchParams.get('clientId') || '';
  const isOperator = role !== 'CLIENT';

  const [notice, setNotice] = useState(null);
  const [disclaimer, setDisclaimer] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const [clientId, setClientId] = useState(isOperator ? (presetClient || roleClientId || '') : '');
  const [clientName, setClientName] = useState('');
  const [goal, setGoal] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [emptyResult, setEmptyResult] = useState(null); // { reasoning, draft } when nothing composable

  const [showAttest, setShowAttest] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveErr, setApproveErr] = useState(null);

  // Fetch the canonical jurisdiction notice once (generating with an empty goal returns it).
  useEffect(() => {
    let alive = true;
    api.generateProtocol({ goalText: '', role, jurisdiction: 'CA', persist: false })
      .then((res) => { if (alive) { setNotice(res.jurisdictionNotice); setDisclaimer(res.disclaimer); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [role]);

  const approved = draft?.status === 'APPROVED_RESOURCE';

  function reset() {
    setDraft(null); setPkg(null); setEmptyResult(null); setErr(null);
    setShowAttest(false); setApproveErr(null);
  }

  async function generate(goalText) {
    const text = (goalText ?? goal).trim();
    if (!text || busy || !acknowledged || !clientId) return;
    setBusy(true); reset();
    try {
      const res = await api.generateProtocol({
        goalText: text, role, jurisdiction: 'CA', clientId, persist: true, acknowledged: true,
      });
      const d = res.draft;
      const items = (d && d.items) || [];
      if (res.empty || !d || items.length === 0 || d.blocked || d.status === 'BLOCKED') {
        setEmptyResult({ reasoning: res.reasoning || [], draft: d || null });
        return;
      }
      const pkgRes = await api.packageForDraft(d.id, role);
      setDraft(d);
      setPkg(pkgRes.package);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function approve({ name, comment }) {
    if (!draft) return;
    setApproving(true); setApproveErr(null);
    try {
      const res = await api.reviewDraft(draft.id, {
        decision: 'APPROVE',
        reviewedBy: name || 'Dr. Vincent Lun',
        comment,
        attestation: { practitionerName: name || 'Dr. Vincent Lun', qualifiedPeptideLiterate: true, reviewedBasis: true },
      });
      const pkgRes = await api.packageForDraft(res.draft.id, role);
      setDraft(res.draft);
      setPkg(pkgRes.package);
      setShowAttest(false);
    } catch (e) {
      setApproveErr(e);
    } finally {
      setApproving(false);
    }
  }

  if (!isOperator) {
    return (
      <>
        <PageHeader title="Client Package" description="The one-click care package — generated and approved by your practitioner." />
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-soft">
            <Lock className="h-4 w-4 text-faint" /> This builder is practitioner-only. Your approved package appears in <span className="font-medium text-primary">My Portal → My Care Package</span>.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="One-Click Client Package"
        description="A goal becomes a protocol, the bloodwork to order, and the nutrition follow-up — generated once, attached to the client's record, approved through the same gate, opened in their portal."
        actions={<StatusChip tone="accent" label="Generate · gate · approve · publish" />}
      />

      {/* Always-visible framing */}
      <div className="mb-5 flex items-start gap-2 rounded-md border border-border-soft bg-muted/40 px-3 py-2 text-2xs leading-relaxed text-soft">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
        <span>
          <span className="font-semibold uppercase tracking-wide text-faint">What this is — </span>
          a composition of work the platform already gated: the generator proposes real catalog items, every clinical boundary is
          enforced server-side, and the bundle stays a <em>DRAFT / resource-only</em> until you attest and approve. Nothing is minted —
          the bloodwork is Dr. Vincent Lun's baseline plus product-driven monitoring (sourced, never invented), and nutrition stays
          honestly pending until the client has labs. Not a prescription, not a diagnosis.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Builder rail */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><Package className="h-4 w-4 text-primary" /> Build a package</CardTitle>
              <CardDescription>Pick the client, describe the goal, generate once.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ClientPicker
                value={clientId}
                onChange={(id) => {
                  setClientId(id);
                  reset();
                  api.clients().then((d) => setClientName((d.clients || []).find((c) => c.id === id)?.name || '')).catch(() => {});
                }}
                autoSelectFirst
                hint="The DRAFT attaches to this client. Only an approved package becomes client-visible."
              />

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
                <>
                  <div>
                    <Label>Client's goal</Label>
                    <Textarea
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      placeholder='e.g. "fat loss + recovery" or "heal a nagging tendon injury"'
                      className="min-h-[64px]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setGoal(ex)}
                        className="rounded-full border border-border-soft bg-card px-2.5 py-1 text-2xs text-soft transition-colors hover:bg-muted"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                  <Button onClick={() => generate()} disabled={busy || !goal.trim() || !clientId} className="w-full">
                    <Sparkles className="h-4 w-4" /> {busy ? 'Generating package…' : 'Generate package'}
                  </Button>
                  {(draft || emptyResult) && (
                    <Button variant="ghost" size="sm" onClick={reset} className="w-full">
                      <RotateCcw className="h-3.5 w-3.5" /> Start over
                    </Button>
                  )}
                </>
              )}
              {err && <ErrorState error={err} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>You are operating as</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <StatusChip tone="accent" label={ROLE_LABELS[role] || role} />
              <p className="text-2xs text-faint">
                Practitioners and admins see the full operator package — research-reported dosing, titration and taper, and the
                clinical rationale. The client only ever sees the approved, softened version in their portal.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>The three facets</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-2xs text-soft">
                <li className="flex gap-1.5"><span className="text-faint">1.</span> <span><span className="font-medium text-soft">Protocol</span> — the gated draft: items, role-shaped dosing, monitoring.</span></li>
                <li className="flex gap-1.5"><span className="text-faint">2.</span> <span><span className="font-medium text-soft">Bloodwork</span> — Dr. Vincent Lun's baseline + product-driven safety monitoring to order.</span></li>
                <li className="flex gap-1.5"><span className="text-faint">3.</span> <span><span className="font-medium text-soft">Nutrition</span> — the naturopath request slip, lab-driven (pending until results exist).</span></li>
              </ul>
            </CardContent>
          </Card>

          {disclaimer && <p className="px-1 text-2xs leading-relaxed text-faint">{disclaimer}</p>}
        </div>

        {/* Package column */}
        <div className="lg:col-span-2">
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-border-soft bg-card p-6 text-sm text-faint shadow-card">
              <Sparkles className="h-4 w-4 animate-pulse text-primary" /> Proposing items, running every gate, composing the bundle…
            </div>
          )}

          {!busy && emptyResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-warning" /> No package composed</CardTitle>
                <CardDescription>The generator returned nothing composable for that goal — shown honestly, never padded.</CardDescription>
              </CardHeader>
              <CardContent>
                {(emptyResult.reasoning || []).length > 0 ? (
                  <ul className="space-y-1 text-2xs text-soft">{emptyResult.reasoning.map((r, i) => <li key={i}>· {r}</li>)}</ul>
                ) : (
                  <p className="text-xs text-soft">No catalog items matched that goal. Try a different phrasing.</p>
                )}
              </CardContent>
            </Card>
          )}

          {!busy && pkg && (
            <div className="space-y-4">
              <PackageView pkg={pkg} />

              {/* Operator action bar — attest → approve → publish */}
              <Card>
                <CardContent className="space-y-3 pt-4">
                  {approveErr && <ErrorState error={approveErr} />}
                  {approved ? (
                    <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success-soft px-3 py-2.5 text-xs text-success">
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Approved by {draft.reviewedBy || 'practitioner'} — this package is now visible to{' '}
                        <span className="font-medium">{clientName || 'the client'}</span> in their portal (My Portal → My Care Package),
                        attached to their record and swappable later through the protocol lifecycle.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-success">
                          <Save className="h-3.5 w-3.5" /> Saved as DRAFT · <span className="font-data">{draft.id}</span> · attached to {clientName || 'client'}
                        </span>
                        {!showAttest && (
                          <Button size="sm" onClick={() => setShowAttest(true)}>Review &amp; approve</Button>
                        )}
                      </div>
                      <p className="text-2xs text-faint">
                        The package is a DRAFT until a practitioner attests and approves. Approving is the only path that makes it
                        client-visible — dosing schedules and the clinical rationale never leave this operator view.
                      </p>
                      {showAttest && <AttestPanel defaultName="Dr. Vincent Lun" onApprove={approve} approving={approving} err={null} />}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {!busy && !pkg && !emptyResult && (
            <Card>
              <CardHeader>
                <CardTitle>Your package preview</CardTitle>
                <CardDescription>Appears here once you generate. Operator preview — full dosing; nutrition is pending until the client has labs.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Package className="h-7 w-7 text-faint" />
                  <p className="text-sm font-medium text-soft">Nothing generated yet</p>
                  <p className="max-w-sm text-xs text-faint">
                    {acknowledged
                      ? 'Pick a client, describe the goal, and Generate package to compose Protocol + Bloodwork + Nutrition in one action.'
                      : 'Acknowledge the Canadian research-service notice to begin.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
