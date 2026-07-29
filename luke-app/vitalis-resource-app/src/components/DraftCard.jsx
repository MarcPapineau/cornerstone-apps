import { useState } from 'react';
import { FileText, ShieldAlert, AlertTriangle, HelpCircle, FlaskConical, Pencil, History, Check, X } from 'lucide-react';
import { fmtDate } from '../lib/utils.js';
import api from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.jsx';
import { Button } from './ui/Button.jsx';
import { Badge } from './ui/Badge.jsx';
import { StatusChip } from './ui/StatusChip.jsx';
import { Label, Input, Textarea } from './ui/Field.jsx';
import { ErrorState } from './ui/States.jsx';
import { ReviewActions } from './ReviewActions.jsx';
import { ProtocolItems } from './protocol/ProtocolDocumentView.jsx';

function bannerFor(d) {
  if (d.blocked || d.status === 'BLOCKED') return ['border-danger/30 bg-danger-soft text-danger', 'BLOCKED — gate failure (see reasons)'];
  if (d.status === 'APPROVED_RESOURCE') return ['border-success/25 bg-success-soft text-success', 'APPROVED RESOURCE — reviewed · client-visible'];
  if (d.status === 'CHANGES_REQUESTED') return ['border-warning/25 bg-warning-soft text-warning', 'CHANGES REQUESTED — practitioner-only'];
  return ['border-warning/25 bg-warning-soft text-warning', 'DRAFT — practitioner-only · not yet client-visible'];
}

const AUDIT_LABEL = {
  ACKNOWLEDGMENT: 'Generated', CLIENT_PROTOCOL_REQUEST: 'Requested by client', MODIFIED: 'Modified',
  ATTESTATION: 'Approved (attested)', PROTOCOL_PAYMENT: 'Payment', LICENSE_ACK: 'License acknowledged',
};

/**
 * DraftCard — the practitioner-facing protocol draft: full dosing (ProtocolItems, operator mode),
 * rationale/warnings/unknowns, an inline EDIT panel (narrative fields, language-gated server-side),
 * an audit trail (generated → modified → approved), and the approval control. NEVER rendered on
 * the client portal.
 */
export function DraftCard({ draft, reviewer, onReviewed, showClient = false }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [audit, setAudit] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const locked = draft.status === 'APPROVED_RESOURCE';
  const [bannerTone, bannerText] = bannerFor(draft);

  function startEdit() {
    setForm({
      title: draft.title || '', goal: draft.goal || '', rationale: draft.rationale || '',
      monitoring: draft.monitoring || '', practitionerNote: draft.practitionerNote || '',
      labsSuggested: (draft.labsSuggested || []).join(', '),
    });
    setErr(null); setEditing(true);
  }
  async function save() {
    setSaving(true); setErr(null);
    try { await api.updateDraft(draft.id, form); setEditing(false); onReviewed && onReviewed(); }
    catch (e) { setErr(e); } finally { setSaving(false); }
  }
  async function toggleAudit() {
    const next = !auditOpen; setAuditOpen(next);
    if (next && audit === null) { try { const r = await api.draftAudit(draft.id); setAudit(r.events || []); } catch { setAudit([]); } }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle>{showClient && draft.clientName ? draft.clientName : (draft.title || 'Protocol draft')}</CardTitle>
            <span className="font-data text-2xs text-faint">{draft.id}</span>
            {draft._demo && <Badge tone="warning">demo</Badge>}
            {draft.requestedBy === 'CLIENT' && <Badge tone="accent">client-requested</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleAudit} className="inline-flex items-center gap-1 text-2xs font-medium text-faint hover:text-primary"><History className="h-3.5 w-3.5" /> Audit</button>
            {!locked && !editing && <button type="button" onClick={startEdit} className="inline-flex items-center gap-1 text-2xs font-medium text-faint hover:text-primary"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
            <StatusChip status={draft.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${bannerTone}`}>
          {draft.blocked ? <ShieldAlert className="h-4 w-4" /> : <FileText className="h-4 w-4" />} {bannerText}
        </div>

        {auditOpen && (
          <div className="rounded-md border border-border-soft bg-muted/40 p-2.5">
            <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Audit trail</div>
            {audit === null ? <p className="text-2xs text-faint">Loading…</p> : audit.length === 0 ? <p className="text-2xs text-faint">No events recorded.</p> : (
              <ul className="space-y-1">
                {audit.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-2xs">
                    <span className="text-soft"><span className="font-medium text-foreground">{AUDIT_LABEL[e.kind] || e.kind}</span>{e.kind === 'MODIFIED' && e.fields ? ` · ${e.fields.join(', ')}` : ''}{e.kind === 'PROTOCOL_PAYMENT' && e.paymentStatus ? ` · ${e.paymentStatus}` : ''}</span>
                    <span className="font-data text-faint">{fmtDate(e.at || e.acceptedAt || e.reviewedAt || e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {editing ? (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-accent-soft/40 p-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-primary">Edit draft — practitioner-only, language-checked</div>
            <div><Label>Title</Label><Input value={form.title} onChange={set('title')} /></div>
            <div><Label>Goal</Label><Input value={form.goal} onChange={set('goal')} /></div>
            <div><Label>Rationale (operator-only)</Label><Textarea value={form.rationale} onChange={set('rationale')} /></div>
            <div><Label>Monitoring</Label><Textarea value={form.monitoring} onChange={set('monitoring')} /></div>
            <div><Label>Practitioner note (client-safe)</Label><Textarea value={form.practitionerNote} onChange={set('practitionerNote')} /></div>
            <div><Label>Labs suggested</Label><Input value={form.labsSuggested} onChange={set('labsSuggested')} placeholder="comma-separated" /></div>
            {err && <ErrorState error={err} />}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}><Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}><X className="h-4 w-4" /> Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {(draft.items || []).length > 0 && (
              <div>
                <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Protocol &amp; dosing schedule</div>
                <ProtocolItems items={draft.items} mode="operator" />
              </div>
            )}
            {draft.rationale && (
              <div><div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Rationale (resource summary)</div><p className="text-xs text-soft">{draft.rationale}</p></div>
            )}
            {draft.monitoring && (
              <div><div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Monitoring</div><p className="text-xs text-soft">{draft.monitoring}</p></div>
            )}
            {draft.practitionerNote && (
              <div><div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Practitioner note (client-safe)</div><p className="text-xs text-soft">{draft.practitionerNote}</p></div>
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
          </>
        )}

        <div className="border-t border-border-soft pt-3">
          <ReviewActions draft={draft} reviewer={reviewer} onDone={onReviewed} />
        </div>
      </CardContent>
    </Card>
  );
}
