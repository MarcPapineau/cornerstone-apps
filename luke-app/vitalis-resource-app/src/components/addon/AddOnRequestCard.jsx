import { useState } from 'react';
import api from '../../lib/api.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';
import { StatusChip } from '../ui/StatusChip.jsx';
import { ErrorState } from '../ui/States.jsx';
import { AttestPanel } from '../protocol/AttestPanel.jsx';
import { AddOnView } from './AddOnView.jsx';

/**
 * AddOnRequestCard — the SHARED practitioner control for one add-on request, used by both the
 * practice-wide Add-on Requests queue AND the client dossier Add-ons tab, so the two never
 * drift. It walks the full lifecycle: confirm fee (no processor — sets paymentStatus only) →
 * generate the DRAFT → attest & approve (the single action that makes it client-visible) or
 * request changes. A draft is rendered through the shared AddOnView and never reaches the
 * client until approved. Educational resource only — never a prescription.
 */
const TYPE_LABEL = { SUPPLEMENT_PLAN: 'Supplement plan', MEAL_PLAN: 'Meal / diet plan' };
const PAYMENT_TONE = { PAID: 'success', MANUALLY_APPROVED: 'success', UNPAID: 'warning' };
const PAYMENT_LABEL = { PAID: 'Paid', MANUALLY_APPROVED: 'Manually approved', UNPAID: 'Unpaid' };

export function AddOnRequestCard({ request, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const draft = request.draft;
  const canGenerate = request.paymentStatus === 'PAID' || request.paymentStatus === 'MANUALLY_APPROVED';
  const approved = draft && draft.status === 'APPROVED_RESOURCE';

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const generate = () => run(() => api.generateAddOn(request.id, { role: 'PRACTITIONER' }));
  const confirmFee = () => run(() => api.markAddOnPaid(request.id, 'MANUALLY_APPROVED'));
  const approve = (name, comment) => run(() => api.reviewAddOn(draft.id, {
    decision: 'APPROVE', reviewedBy: name, comment,
    attestation: { practitionerName: name, qualifiedPeptideLiterate: true, reviewedBasis: true },
    role: 'PRACTITIONER',
  }));
  const requestChanges = () => run(() => api.reviewAddOn(draft.id, { decision: 'REQUEST_CHANGES', reviewedBy: 'Dr. Vincent Lun', role: 'PRACTITIONER' }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{request.clientName || TYPE_LABEL[request.requestType] || 'Add-on'}</CardTitle>
            <div className="mt-1 text-2xs uppercase tracking-wide text-faint">
              {TYPE_LABEL[request.requestType] || 'Add-on'}{request.tier ? ` · ${request.tier}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusChip status={request.status} />
            <Badge tone={PAYMENT_TONE[request.paymentStatus] || 'neutral'}>
              {PAYMENT_LABEL[request.paymentStatus] || request.paymentStatus}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!draft && canGenerate && (
          <div className="space-y-2">
            <p className="text-xs text-soft">Fee cleared. Generate the educational draft for your review.</p>
            <Button size="sm" onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate draft'}</Button>
            {err && <ErrorState error={err} />}
          </div>
        )}

        {!draft && !canGenerate && (
          <div className="space-y-2">
            <p className="text-xs text-soft">Awaiting fee confirmation. There’s no payment processor — confirm the fee was handled to unlock generation.</p>
            <Button size="sm" variant="outline" onClick={confirmFee} disabled={busy}>{busy ? 'Confirming…' : 'Confirm fee & approve'}</Button>
            {err && <ErrorState error={err} />}
          </div>
        )}

        {draft && (
          <div className="space-y-3">
            <AddOnView addon={draft} />
            {approved ? (
              <p className="text-xs font-medium text-success">Approved — visible to the client.</p>
            ) : (
              <>
                <AttestPanel defaultName="Dr. Vincent Lun" approving={busy} err={err} onApprove={({ name, comment }) => approve(name, comment)} />
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={requestChanges} disabled={busy}>Request changes</Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AddOnRequestCard;
