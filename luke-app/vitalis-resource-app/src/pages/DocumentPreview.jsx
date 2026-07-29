import { useParams, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import PeptideProtocolDocument from '../components/document/PeptideProtocolDocument.jsx';
import NutritionDocument from '../components/document/NutritionDocument.jsx';
import SupplementDocument from '../components/document/SupplementDocument.jsx';
import MealDocument from '../components/document/MealDocument.jsx';
import BloodRequisitionDocument from '../components/document/BloodRequisitionDocument.jsx';

/**
 * DocumentPreview — renders a server-built Vitalis dossier for a given silo + draft.
 * Route: /document/:silo/:id?role=PRACTITIONER|CLIENT. The server enforces that a CLIENT can
 * only ever receive an APPROVED document (a 403 otherwise) — this page only renders.
 */
export default function DocumentPreview() {
  const { silo, id } = useParams();
  const [sp, setSp] = useSearchParams();
  const role = (sp.get('role') || 'PRACTITIONER').toUpperCase();
  const q = useFetch(() => api.document(silo, id, role), [silo, id, role]);
  const S = String(silo || '').toUpperCase();

  return (
    <div>
      <div className="vd-no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs">
          <span className="mr-1 text-faint">View as</span>
          {['PRACTITIONER', 'CLIENT'].map((r) => (
            <button
              key={r}
              onClick={() => setSp({ role: r })}
              className={`rounded px-2.5 py-1 font-medium ${role === r ? 'bg-primary text-white' : 'text-soft hover:bg-muted'}`}
            >
              {r === 'PRACTITIONER' ? 'Practitioner' : 'Client (approved)'}
            </button>
          ))}
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-soft hover:bg-muted">
          <Printer className="h-3.5 w-3.5" /> Print / PDF
        </button>
      </div>

      {q.loading ? <Loading label="Rendering document…" />
        : q.error ? <ErrorState error={q.error} />
          : !(q.data && q.data.document) ? <EmptyState title="No document" />
            : S === 'PEPTIDE' ? <PeptideProtocolDocument doc={q.data.document} />
              : S === 'NUTRITION' ? <NutritionDocument doc={q.data.document} />
                : S === 'SUPPLEMENT' ? <SupplementDocument doc={q.data.document} />
                  : S === 'MEAL' ? <MealDocument doc={q.data.document} />
                    : S === 'BLOOD_REQ' ? <BloodRequisitionDocument doc={q.data.document} />
                      : <EmptyState title={`${S} document not yet implemented`} hint="This document vertical is on the build path." />}
    </div>
  );
}
