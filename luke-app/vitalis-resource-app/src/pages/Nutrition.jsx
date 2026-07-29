import { useEffect, useState } from 'react';
import {
  Salad, FileText, Plus, Trash2, Sparkles, Info, FlaskConical, Loader2,
} from 'lucide-react';
import { useRole, ROLE_LABELS } from '../lib/roleContext.jsx';
import api from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Input, Textarea } from '../components/ui/Field.jsx';
import { ErrorState, EmptyState } from '../components/ui/States.jsx';
import { DropZone } from '../components/ui/DropZone.jsx';
import { SlipView } from '../components/nutrition/SlipView.jsx';

/**
 * Nutrition — the wired Nutrition module: drag-drop / paste a lab report → confirm the parsed
 * values → the SERVER analyzes deficiencies into a "request for your naturopath" slip.
 *
 * The whole point (Marc's brief): the client drops their own bloodwork, the system reads it,
 * and it hands back a DRAFT / resource-only slip to bring to Dr. Vincent Lun — "ask him for
 * these, and to flag anything missing." It is explicitly NOT a prescription and NOT a
 * diagnosis: every deficiency is shown two honest ways (what the studies show ⊕ what naturopathic
 * practice does), grounded in peer-reviewed nutrient literature (Health Canada used only as
 * compliance/reference context, never an evidence authority — see vitalis-research-doctrine.md), with out-of-range framed
 * as "discuss," never "you have X."
 *
 * Safety architecture mirrors the rest of the platform:
 *   • Ingest is local-first — the file is read in the browser; only the text is POSTed to YOUR
 *     Vitalis server to parse. No third-party OCR, no lab data leaving to anyone else.
 *   • The server is authoritative — the browser never decides a deficiency; it asks /nutrition.
 *   • Role-softened — the server omits the citation list + naturopathic pattern for CLIENT; we
 *     render purely by key-presence (BasisBlock), never reconstructing what was withheld.
 *   • Electrolytes route to provider-review-only — never an OTC "take this" suggestion.
 */

const emptyRow = () => ({ marker: '', value: '', unit: '', refLow: '', refHigh: '' });

const SAMPLE = `Marker, Value, Unit, Low, High
Vitamin D 25-OH, 18, ng/mL, 30, 100
Ferritin, 22, ng/mL, 30, 400
Vitamin B12, 410, pg/mL, 138, 652
Magnesium, 1.6, mg/dL, 1.7, 2.2
Potassium, 5.6, mmol/L, 3.5, 5.1`;

const rowsToValues = (rs) =>
  rs
    .filter((r) => String(r.marker).trim() && r.value !== '' && r.value != null)
    .map((r) => ({
      marker: String(r.marker).trim(),
      value: r.value,
      unit: r.unit || null,
      refLow: r.refLow === '' ? null : r.refLow,
      refHigh: r.refHigh === '' ? null : r.refHigh,
    }));

export default function Nutrition() {
  const { role, clientId: roleClientId } = useRole();
  const isOperator = role !== 'CLIENT';

  const [clientId, setClientId] = useState(isOperator ? '' : (roleClientId || ''));
  const [clientName, setClientName] = useState('');

  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState(null);

  const [slip, setSlip] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeErr, setAnalyzeErr] = useState(null);

  // The LIVE example — the client's OWN most-recent lab draw, resolved server-side (reuses the
  // same nutritionSlipForClient helper as the Client Package, so the two never drift). Loaded on
  // mount for CLIENT so the page opens populated instead of an empty analyzer. The drop/paste flow
  // remains available below to "analyze a different report"; analyzing replaces the visible slip.
  const [liveSlip, setLiveSlip] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null); // 'LIVE' | 'PENDING_LABS' | null
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveErr, setLiveErr] = useState(null); // a real load failure — NEVER conflated with "no labs"
  // `true` once a person runs the drop/paste analyzer — from then on, show that result, not the live example.
  const [showAnalyzer, setShowAnalyzer] = useState(false);

  useEffect(() => {
    // Only the CLIENT portal auto-loads a live example; operators choose a client + report explicitly.
    if (isOperator || !clientId) { setLiveStatus(null); setLiveSlip(null); setLiveErr(null); return; }
    let cancelled = false;
    setLiveLoading(true); setLiveErr(null);
    api.nutritionSlip({ clientId, role })
      .then((res) => {
        if (cancelled) return;
        setLiveSlip(res.slip || null);
        // Trust the server's honest status. Only PENDING_LABS means "no labs on file" — a fetch
        // failure must surface as an error, never as a false "no labs yet" claim.
        setLiveStatus(res.status || (res.slip ? 'LIVE' : 'PENDING_LABS'));
      })
      .catch((e) => { if (!cancelled) { setLiveSlip(null); setLiveStatus(null); setLiveErr(e); } })
      .finally(() => { if (!cancelled) setLiveLoading(false); });
    return () => { cancelled = true; };
  }, [isOperator, clientId, role]);

  const setRow = (i, k) => (e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  async function parse(text) {
    const t = (text ?? rawText).trim();
    if (!t) return;
    setParsing(true); setParseErr(null); setSlip(null);
    try {
      const res = await api.nutritionParse(t);
      setRows((res.rows || []).map((r) => ({
        marker: r.marker || '', value: r.value ?? '', unit: r.unit || '',
        refLow: r.refLow ?? '', refHigh: r.refHigh ?? '',
      })));
      setSkipped(res.skipped || []);
      if (!(res.rows || []).length) setParseErr(new Error('No lab values could be read. Check the format, or enter rows manually below.'));
    } catch (e) { setParseErr(e); } finally { setParsing(false); }
  }

  function onDroppedText(text, name) {
    setRawText(text);
    setFileName(name || '');
    setParseErr(null);
    parse(text);
  }

  async function analyze() {
    const values = rowsToValues(rows);
    if (!values.length) { setAnalyzeErr(new Error('Add at least one marker with a value before analyzing.')); return; }
    setAnalyzing(true); setAnalyzeErr(null);
    try {
      const res = await api.nutritionAnalyze({
        role,
        clientId: clientId || undefined,
        clientName: clientName || undefined,
        values,
      });
      setSlip(res.slip);
      setShowAnalyzer(true); // a freshly analyzed report now takes over the slip column from the live example
    } catch (e) { setAnalyzeErr(e); } finally { setAnalyzing(false); }
  }

  function loadSample() {
    setRawText(SAMPLE);
    setFileName('sample-labs.csv');
    setParseErr(null);
    parse(SAMPLE);
  }

  const valueCount = rowsToValues(rows).length;

  return (
    <>
      <PageHeader
        title="Nutrition — Naturopath Request Slip"
        description="Drop or paste a lab report. The system reads it, then builds a resource-only slip of nutrients to discuss with Dr. Vincent Lun — grounded in nutrition science, never a prescription or diagnosis."
        actions={<StatusChip tone="accent" label="Lab → deficiency → request slip" />}
      />

      {/* Always-visible safety + privacy framing */}
      <div className="mb-5 flex items-start gap-2 rounded-md border border-border-soft bg-muted/40 px-3 py-2 text-2xs leading-relaxed text-soft">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
        <span>
          <span className="font-semibold uppercase tracking-wide text-faint">How this stays safe — </span>
          your file is read <em>in your browser</em>; only the text is sent to your own Vitalis server to parse and analyze — never to a third party.
          The result is a DRAFT / resource-only slip: out-of-range is framed as “discuss,” electrolytes route to provider review with no supplement
          suggested, and every nutrient is attributed (what the studies show ⊕ what naturopathic practice does). It is not a prescription and not a diagnosis.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Ingest + confirm column */}
        <div className="space-y-5 lg:col-span-3">
          {isOperator && (
            <Card className="no-print">
              <CardHeader>
                <CardTitle>Whose labs?</CardTitle>
                <CardDescription>The slip is addressed to this client and cross-references their current peptide protocol.</CardDescription>
              </CardHeader>
              <CardContent>
                <ClientPicker
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    setSlip(null);
                    api.clients().then((d) => setClientName((d.clients || []).find((c) => c.id === id)?.name || '')).catch(() => {});
                  }}
                  autoSelectFirst
                  hint="Demo data only. The client's own lab values never leave your server."
                />
              </CardContent>
            </Card>
          )}

          <Card className="no-print">
            <CardHeader className="flex-row items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
                <Salad className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle>{isOperator ? '1 · Bring in the lab values' : 'Analyze a different report'}</CardTitle>
                <CardDescription>
                  {isOperator
                    ? 'Drag-drop a file, paste the text, or try a sample — then confirm what was read.'
                    : 'Your example on the right is built from your latest labs on file. To work from another report, drag-drop a file, paste the text, or try a sample — then confirm what was read.'}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <DropZone onText={onDroppedText} onError={setParseErr} fileName={fileName} busy={parsing} />

              <div>
                <Textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={'Or paste lab rows here, e.g.\nVitamin D 25-OH, 18, ng/mL, 30, 100\nFerritin, 22, ng/mL, 30, 400'}
                  className="min-h-[88px] font-data text-xs"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => parse()} disabled={parsing || !rawText.trim()}>
                    {parsing ? 'Reading…' : 'Extract values'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={loadSample} disabled={parsing}>Try a sample</Button>
                  {(rawText || rows.length > 0) && (
                    <Button size="sm" variant="ghost" onClick={() => { setRawText(''); setFileName(''); setRows([]); setSkipped([]); setSlip(null); setParseErr(null); }}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {parseErr && <ErrorState error={parseErr} />}

              {skipped.length > 0 && (
                <details className="rounded-md border border-border-soft">
                  <summary className="cursor-pointer list-none px-3 py-1.5 text-2xs font-medium text-faint hover:text-soft">
                    {skipped.length} line{skipped.length === 1 ? '' : 's'} skipped (headers / notes) — review
                  </summary>
                  <ul className="space-y-0.5 px-3 pb-2 font-data text-2xs text-faint">
                    {skipped.map((l, i) => <li key={i} className="truncate">· {l}</li>)}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>

          {/* Confirm grid */}
          <Card className="no-print">
            <CardHeader>
              <CardTitle>2 · Confirm what was read</CardTitle>
              <CardDescription>Correct anything the parser misread. Ranges are your lab report’s own — nothing is assumed.</CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <EmptyState title="No values yet" hint="Drop, paste, or load a sample above to populate this grid." icon={FileText} />
              ) : (
                <>
                  <div className="mb-1.5 grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] gap-2 px-1 text-2xs font-semibold uppercase tracking-wide text-faint">
                    <span>Marker</span><span>Value</span><span>Unit</span><span>Ref low</span><span>Ref high</span><span />
                  </div>
                  <div className="space-y-2">
                    {rows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] gap-2">
                        <Input value={r.marker} onChange={setRow(i, 'marker')} placeholder="Vitamin D 25-OH" />
                        <Input value={r.value} onChange={setRow(i, 'value')} placeholder="18" type="number" step="any" />
                        <Input value={r.unit} onChange={setRow(i, 'unit')} placeholder="ng/mL" />
                        <Input value={r.refLow} onChange={setRow(i, 'refLow')} placeholder="30" type="number" step="any" />
                        <Input value={r.refHigh} onChange={setRow(i, 'refHigh')} placeholder="100" type="number" step="any" />
                        <Button variant="ghost" size="icon" onClick={() => delRow(i)} aria-label="Remove row">
                          <Trash2 className="h-4 w-4 text-faint" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button variant="subtle" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add marker</Button>
                <Button onClick={analyze} disabled={analyzing || valueCount === 0}>
                  <Sparkles className="h-4 w-4" /> {analyzing ? 'Analyzing…' : `Analyze ${valueCount || ''} value${valueCount === 1 ? '' : 's'}`.trim()}
                </Button>
              </div>
              {analyzeErr && <div className="mt-3"><ErrorState error={analyzeErr} /></div>}
            </CardContent>
          </Card>
        </div>

        {/* Slip / output column */}
        <div className="lg:col-span-2">
          {showAnalyzer && slip ? (
            // The drop/paste analyzer produced a slip — it takes over the column. For a client, closing
            // it falls back to the live example from their own labs (operators just clear it).
            <div className="space-y-2">
              {!isOperator && (liveSlip || liveStatus === 'PENDING_LABS') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="no-print"
                  onClick={() => { setSlip(null); setShowAnalyzer(false); }}
                >
                  ← Back to the example from my latest labs
                </Button>
              )}
              <SlipView slip={slip} onClose={() => { setSlip(null); setShowAnalyzer(false); }} />
            </div>
          ) : !isOperator && liveLoading ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-8 text-sm text-soft">
                <Loader2 className="h-4 w-4 animate-spin text-faint" /> Loading the example from your latest labs…
              </CardContent>
            </Card>
          ) : !isOperator && liveSlip ? (
            // LIVE EXAMPLE — populated from the client's own most-recent lab draw, resolved server-side.
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-primary/15 bg-accent-soft px-3 py-2 text-2xs leading-relaxed text-soft no-print">
                <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  <span className="font-semibold uppercase tracking-wide text-primary">Example from your latest labs · </span>
                  this is an educational research resource built from your own most-recent lab values, to review with
                  Dr. Vincent Lun. It is resource-only — never a prescription or a diagnosis. To work from a different
                  report, drop or paste it on the left and choose <em>Analyze</em>.
                </span>
              </div>
              <SlipView slip={liveSlip} />
            </div>
          ) : !isOperator && liveErr ? (
            // A real load failure — surface it honestly. NOT "no labs" (that would be a false claim).
            <Card>
              <CardHeader>
                <CardTitle>Couldn’t load your example</CardTitle>
                <CardDescription>We couldn’t reach your latest labs just now. You can still analyze a report on the left.</CardDescription>
              </CardHeader>
              <CardContent><ErrorState error={liveErr} /></CardContent>
            </Card>
          ) : !isOperator && liveStatus === 'PENDING_LABS' ? (
            // No labs on file — honest empty guidance, never a fabricated slip.
            <Card>
              <CardHeader>
                <CardTitle>No labs on file yet</CardTitle>
                <CardDescription>Your nutrition example builds from your own recorded lab values — resource-only, to review with Dr. Vincent Lun.</CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  title="Nothing to show until your first lab draw is recorded"
                  hint="Once your bloodwork is on file, an example slip from your latest results will appear here. You can also drop or paste a report on the left to analyze one now."
                  icon={FlaskConical}
                />
                <div className="mt-3 space-y-1.5 text-2xs text-faint">
                  <p className="flex items-center gap-1.5"><span className="text-primary">You are viewing as</span> <StatusChip tone="neutral" label={ROLE_LABELS[role] || role} /></p>
                  <p>Client view: the studies’ finding and reported benefits, framed for the conversation with your naturopath — the raw citation list and clinical pattern stay with your practitioner.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            // Operator (or client before a slip exists): the original "analyze to generate" empty state.
            <Card>
              <CardHeader>
                <CardTitle>Your request slip</CardTitle>
                <CardDescription>Appears here once you analyze. Resource-only — built to bring to Dr. Vincent Lun.</CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  title="Nothing analyzed yet"
                  hint="Bring in lab values, confirm them, then Analyze to generate the naturopath request slip."
                  icon={Salad}
                />
                <div className="mt-3 space-y-1.5 text-2xs text-faint">
                  <p className="flex items-center gap-1.5"><span className="text-primary">You are viewing as</span> <StatusChip tone={isOperator ? 'accent' : 'neutral'} label={ROLE_LABELS[role] || role} /></p>
                  <p>
                    {isOperator
                      ? 'Practitioner view: full attribution including citations and the naturopathic pattern for each nutrient.'
                      : 'Client view: the studies’ finding and reported benefits, framed for the conversation with your naturopath — the raw citation list and clinical pattern stay with your practitioner.'}
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
