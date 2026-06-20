import { useState } from 'react';
import { ClipboardList, FlaskConical, Layers, FileWarning } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Loading, ErrorState } from '../components/ui/States.jsx';

const noop = () => Promise.resolve(null);

function PanelCard({ panel }) {
  const sourced = panel.status === 'SOURCED' || panel.ok;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{panel.label}</CardTitle>
          <StatusChip status={panel.status} />
        </div>
        {panel.dynamic && <CardDescription>Compound-specific — layered on baseline from the client's current products.</CardDescription>}
      </CardHeader>
      <CardContent>
        {sourced ? (
          (panel.markers || []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {panel.markers.map((m) => (
                <Badge key={m} tone="neutral" className="font-data">{m}</Badge>
              ))}
            </div>
          ) : panel.dynamic ? (
            <p className="text-xs text-faint">No compound-specific markers yet — select a client whose current products map to a monitoring addition.</p>
          ) : (
            <p className="text-xs text-faint">Subset of the baseline panel.</p>
          )
        ) : (
          <div className="rounded-md border border-warning/25 bg-warning-soft p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-warning">
              <FileWarning className="h-3.5 w-3.5" /> Needs source
            </div>
            <p className="text-xs text-warning">{panel.message || panel.needs || 'Markers not enumerated in any source — not invented.'}</p>
          </div>
        )}
        {(panel.detail || []).length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-border-soft pt-2.5">
            {panel.detail.map((d, i) => (
              <div key={i} className="text-2xs text-faint">
                <span className="font-medium text-soft">{d.matchedOn}</span> → {d.markers.join(', ')} <span className="text-faint">· {d.cadence}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LabRecommend() {
  const [clientId, setClientId] = useState('');
  const clientQ = useFetch(() => (clientId ? api.client(clientId) : noop()), [clientId]);
  const products = clientQ.data?.client?.currentProducts || [];
  const panelsQ = useFetch(() => api.labPanels(products), [products.join('|')]);

  const baseline = panelsQ.data?.baseline;
  const optional = panelsQ.data?.optional || [];

  return (
    <>
      <PageHeader
        title="Lab Recommendations"
        description="Which panels to order — Dr. Vincent Lun's baseline assessment plus product-aware safety monitoring. Unsourced panels are shown honestly as NEEDS_SOURCE; markers are never invented."
        actions={<StatusChip tone="success" label="Markers Never Invented" />}
      />

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Drive safety monitoring from a client</CardTitle>
          <CardDescription>The dynamic panel layers compound-specific markers based on the selected client's current products.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <ClientPicker value={clientId} onChange={setClientId} autoSelectFirst className="w-72 max-w-full" label="Client (optional)" />
            <div className="flex flex-wrap items-center gap-1.5">
              {products.length > 0 ? (
                products.map((p) => <Badge key={p} tone="accent">{p}</Badge>)
              ) : (
                <span className="text-xs text-faint">No current products on this client — baseline only.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {panelsQ.loading ? (
        <Loading label="Loading panels…" />
      ) : panelsQ.error ? (
        <ErrorState error={panelsQ.error} />
      ) : (
        <>
          {baseline && (
            <Card className="mb-5">
              <CardHeader className="flex-row items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
                  <Layers className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle>{baseline.label}</CardTitle>
                    <StatusChip status={baseline.status} />
                  </div>
                  {baseline.source && <CardDescription>{baseline.source}</CardDescription>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(baseline.sections || []).map((s) => (
                    <div key={s.section} className="rounded-md border border-border-soft p-3">
                      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">{s.section}</div>
                      <ul className="space-y-0.5">
                        {s.markers.map((m) => (
                          <li key={m} className="text-xs text-soft">{m}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-faint">
            <FlaskConical className="h-3.5 w-3.5" /> Optional &amp; compound-specific panels
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {optional.map((p) => (
              <PanelCard key={p.id} panel={p} />
            ))}
          </div>
        </>
      )}

      {panelsQ.data?.provenance?.source && (
        <p className="mt-4 text-2xs text-faint">Source: {panelsQ.data.provenance.source}{panelsQ.data.provenance.locked ? ` · locked ${panelsQ.data.provenance.locked}` : ''}</p>
      )}
    </>
  );
}
