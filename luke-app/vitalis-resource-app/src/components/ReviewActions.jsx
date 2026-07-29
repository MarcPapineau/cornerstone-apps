import { useState } from 'react';
import { BadgeCheck, ShieldAlert } from 'lucide-react';
import api from '../lib/api.js';
import { fmtDate } from '../lib/utils.js';
import { Button } from './ui/Button.jsx';
import { Textarea } from './ui/Field.jsx';
import { ErrorState } from './ui/States.jsx';

/**
 * ReviewActions — the practitioner's approval boundary control. APPROVE is the ONLY
 * action that flips a draft to APPROVED_RESOURCE (the single client-visible state);
 * REQUEST_CHANGES keeps it practitioner-only. The server enforces this regardless —
 * this UI only sends the decision.
 */
export function ReviewActions({ draft, reviewer, onDone }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);

  const blocked = draft.blocked || draft.status === 'BLOCKED';
  const approved = draft.status === 'APPROVED_RESOURCE';

  async function decide(decision) {
    setBusy(decision);
    setErr(null);
    try {
      await api.reviewDraft(draft.id, { decision, reviewedBy: reviewer || 'Dr. Vincent Lun', comment: comment.trim() });
      setComment('');
      onDone && onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy('');
    }
  }

  if (approved) {
    return (
      <div className="inline-flex items-center gap-1.5 text-2xs font-medium text-success">
        <BadgeCheck className="h-3.5 w-3.5" /> Approved & client-visible · {draft.reviewedBy || '—'} · {fmtDate(draft.reviewedAt)}
      </div>
    );
  }
  if (blocked) {
    return (
      <div className="inline-flex items-center gap-1.5 text-2xs font-medium text-danger">
        <ShieldAlert className="h-3.5 w-3.5" /> Gate-blocked — clear failures before this can be approved.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional note to attach to this decision…"
        className="min-h-[52px] text-xs"
      />
      {err && <ErrorState error={err} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide('APPROVE')} disabled={!!busy}>
          {busy === 'APPROVE' ? 'Approving…' : 'Approve → client-visible'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide('REQUEST_CHANGES')} disabled={!!busy}>
          {busy === 'REQUEST_CHANGES' ? 'Saving…' : 'Request changes'}
        </Button>
      </div>
    </div>
  );
}
