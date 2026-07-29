import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '../ui/Button.jsx';
import { Label, Input, Textarea } from '../ui/Field.jsx';
import { ErrorState } from '../ui/States.jsx';

/**
 * AttestPanel — the practitioner attestation gate (liability lever 4). ONE component, shared by
 * the chat generator (ProtocolChat) and the Client Package page, so the wording + the three
 * required attestations never drift between approval surfaces.
 *
 * Approving a dosed protocol for a specific client requires the practitioner to attest:
 * qualified + peptide-literate + independently-reviewed-the-basis. The server logs the
 * attestation and only then flips the draft to APPROVED_RESOURCE (the single client-visible
 * state). Dosing schedules never leave the practitioner view.
 */
export function AttestPanel({ defaultName = 'Dr. Vincent Lun', onApprove, approving, err }) {
  const [name, setName] = useState(defaultName);
  const [qualified, setQualified] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [comment, setComment] = useState('');
  const ready = name.trim() && qualified && reviewed;
  return (
    <div className="mt-3 space-y-3 rounded-md border border-primary/20 bg-accent-soft/60 p-3">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-primary">
        <Lock className="h-3.5 w-3.5" /> Practitioner attestation required to approve
      </div>
      <div>
        <Label>Reviewing practitioner</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Vincent Lun" />
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-soft">
        <input type="checkbox" checked={qualified} onChange={(e) => setQualified(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[--ring]" />
        I am a qualified, peptide-literate practitioner.
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-soft">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[--ring]" />
        I have independently reviewed the basis of this recommendation.
      </label>
      <div>
        <Label>Review note (optional)</Label>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Adjustments, context, or instructions captured with the approval." className="min-h-[56px]" />
      </div>
      {err && <ErrorState error={err} />}
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-faint">Approving makes the resource visible to the client. Dosing schedules never leave the practitioner view.</p>
        <Button size="sm" onClick={() => onApprove({ name: name.trim(), comment })} disabled={!ready || approving}>
          {approving ? 'Recording…' : 'Attest & approve'}
        </Button>
      </div>
    </div>
  );
}

export default AttestPanel;
