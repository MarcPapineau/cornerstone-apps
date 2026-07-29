import { useState } from 'react';
import { Microscope, Search, ExternalLink, FlaskConical, AlertTriangle, Radio } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtInt } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Spinner, Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';

const LEVEL_TONE = { HIGH: 'success', MODERATE: 'accent', LOW: 'warning', EMERGING: 'warning', PRECLINICAL: 'warning', UNKNOWN: 'neutral' };
const levelTone = (l) => LEVEL_TONE[String(l || '').toUpperCase()] || 'neutral';

function Citation({ c }) {
  return (
    <li className="rounded-md border border-border-soft p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{c.title || 'Untitled source'}</span>
        <Badge tone={c.type === 'ClinicalTrial' ? 'accent' : 'neutral'}>{c.type || 'Other'}</Badge>
      </div>
      {c.source && <div className="mt-0.5 text-2xs text-faint">{c.source}</div>}
      {c.url && (
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
        >
          {c.url.replace(/^https?:\/\//, '').slice(0, 48)}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}

function EvidenceDetail({ compoundId, name }) {
  const { data, loading, error } = useFetch(() => api.evidence(compoundId), [compoundId]);
  if (loading) return <Loading label="Running research gate…" />;
  if (error) return <ErrorState error={error} />;
  const r = data?.research;
  if (!r) return null;

  if (r.level === 'UNKNOWN') {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{name}</h3>
        <div className="rounded-md border border-border-soft bg-muted/40 p-3 text-xs text-soft">
          <StatusChip tone="neutral" label="UNKNOWN" />
          <p className="mt-2">{r.message}</p>
          <p className="mt-1 text-faint">No recommendation can be made. The gate never fabricates a citation to fill a gap.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{name}</h3>
          <StatusChip tone={levelTone(r.level)} label={`${r.level} evidence`} />
        </div>
        <p className="mt-1 text-2xs text-faint">The app surfaces evidence for a provider decision — it never recommends.</p>
      </div>

      {r.mechanism && (
        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Mechanism</div>
          <p className="text-xs text-soft">{r.mechanism}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{fmtInt(r.citationCount)} citations</Badge>
        {r.hasClinicalTrial ? (
          <Badge tone="accent"><FlaskConical className="h-3 w-3" /> {r.clinicalTrialStatus || 'Clinical trial'}</Badge>
        ) : (
          <Badge tone="neutral">No trial cited</Badge>
        )}
      </div>

      {(r.contraindicationFlags || []).length > 0 && (
        <div className="rounded-md border border-warning/25 bg-warning-soft p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Contraindication flags
          </div>
          <ul className="space-y-0.5 text-xs text-warning">
            {r.contraindicationFlags.map((f) => (
              <li key={f}>· {f}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Sourced citations</div>
        {(r.citations || []).length === 0 ? (
          <p className="text-xs text-faint">None recorded.</p>
        ) : (
          <ul className="space-y-2">
            {r.citations.map((c, i) => (
              <Citation key={c.url || i} c={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LiveResultGroup({ label, group }) {
  const tone = group.status === 'LIVE' ? 'success' : group.status === 'STUB' ? 'neutral' : 'warning';
  return (
    <div className="rounded-md border border-border-soft p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <StatusChip tone={tone} label={group.status} />
      </div>
      {group.message && <p className="text-2xs text-faint">{group.message}</p>}
      {(group.results || []).length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {group.results.map((x, i) => (
            <li key={x.url || x.pmid || x.nctId || i} className="text-xs">
              <a href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-primary hover:underline">
                <span>{x.title || x.nctId || x.pmid}</span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
              </a>
              {(x.source || x.status) && <span className="ml-1 text-2xs text-faint">· {x.source || x.status}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Research() {
  const index = useFetch(() => api.evidenceIndex(), []);
  const meta = useFetch(() => api.meta(), []);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);

  // Live lookup state.
  const [term, setTerm] = useState('');
  const [live, setLive] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveErr, setLiveErr] = useState(null);

  const entries = (index.data?.index || []).filter((e) =>
    !filter || e.name.toLowerCase().includes(filter.toLowerCase()) || e.compoundId.includes(filter.toLowerCase()),
  );
  const liveConnectors = (meta.data?.connectors || []).filter((c) => c.status === 'LIVE').length;

  async function runLookup(e) {
    e.preventDefault();
    if (!term.trim()) return;
    setLiveLoading(true);
    setLiveErr(null);
    try {
      const res = await api.researchLookup(term.trim());
      setLive(res.lookup);
    } catch (err) {
      setLiveErr(err);
    } finally {
      setLiveLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Research Gate"
        description="Evidence tiers from the verified corpus, plus live PubMed / ClinicalTrials.gov lookup. Missing evidence returns UNKNOWN — never a fabricated source."
        actions={<StatusChip tone="success" label={`${fmtInt(liveConnectors)} Live Connectors`} />}
      />

      <Card className="mb-5">
        <CardHeader className="flex-row items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
            <Radio className="h-4.5 w-4.5" />
          </div>
          <div>
            <CardTitle>Live lookup</CardTitle>
            <CardDescription>Hits real public APIs. On failure each source returns UNKNOWN — it never invents results.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={runLookup} className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. BPC-157 tendon healing" className="pl-9" />
            </div>
            <Button type="submit" disabled={liveLoading || !term.trim()}>
              {liveLoading ? <><Spinner className="text-primary-foreground" /> Searching…</> : 'Look up'}
            </Button>
          </form>
          {liveErr && <div className="mt-3"><ErrorState error={liveErr} /></div>}
          {live && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LiveResultGroup label="PubMed" group={live.pubmed} />
              <LiveResultGroup label="ClinicalTrials.gov" group={live.clinicaltrials} />
              <LiveResultGroup label="Health Canada DPD" group={live.healthcanada_dpd} />
              <LiveResultGroup label="openFDA" group={live.openfda} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Evidence corpus</CardTitle>
            <CardDescription>{fmtInt((index.data?.index || []).length)} compounds with verified citations.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter compounds…" className="pl-9" />
            </div>
            {index.loading ? (
              <Loading />
            ) : index.error ? (
              <ErrorState error={index.error} />
            ) : (
              <ul className="max-h-[28rem] space-y-1 overflow-y-auto scrollbar-thin pr-1">
                {entries.map((e) => {
                  const active = selected?.compoundId === e.compoundId;
                  return (
                    <li key={e.compoundId}>
                      <button
                        type="button"
                        onClick={() => setSelected(e)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-muted'}`}
                      >
                        <span className="min-w-0 truncate text-xs font-medium text-foreground">{e.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="font-data text-2xs text-faint">{e.citationCount}</span>
                          <StatusChip tone={levelTone(e.evidenceLevel)} label={e.evidenceLevel} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Evidence detail</CardTitle>
            <CardDescription>Select a compound to run the research gate against the verified corpus.</CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <EvidenceDetail compoundId={selected.compoundId} name={selected.name} />
            ) : (
              <EmptyState title="No compound selected" hint="Pick a compound from the corpus to see its sourced evidence." icon={Microscope} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
