import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TestTubes, Plus, Trash2, Stethoscope, CheckCircle2, Upload } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ClientPicker } from '../components/ClientPicker.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { DropZone } from '../components/ui/DropZone.jsx';

const noop = () => Promise.resolve(null);
const FLAG_TONE = { IN_RANGE: 'success', OUT_OF_RANGE_LOW: 'danger', OUT_OF_RANGE_HIGH: 'danger', NO_RANGE: 'neutral' };
const emptyRow = () => ({ marker: '', value: '', unit: '', refLow: '', refHigh: '' });

export default function LabResults() {
  const [searchParams] = useSearchParams();
  const [clientId, setClientId] = useState(searchParams.get('clientId') || '');
  const [rows, setRows] = useState([emptyRow()]);
  const [panelId, setPanelId] = useState('baseline');
  const [fasting, setFasting] = useState('true');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  // Drag-drop / paste import — reuses the same /nutrition/parse reader as the Nutrition module,
  // then fills THIS grid. Local-first: the file is read in the browser, only text is parsed.
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState(null);
  const [importSkipped, setImportSkipped] = useState([]);

  const resultsQ = useFetch(() => (clientId ? api.labResults(clientId) : noop()), [clientId]);
  const results = resultsQ.data?.results || [];

  const setRow = (i, k) => (e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const delRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  async function runImport(text) {
    const t = (text ?? importText).trim();
    if (!t) return;
    setImporting(true);
    setImportErr(null);
    try {
      const res = await api.nutritionParse(t);
      const parsed = (res.rows || []).map((r) => ({
        marker: r.marker || '', value: r.value ?? '', unit: r.unit || '',
        refLow: r.refLow ?? '', refHigh: r.refHigh ?? '',
      }));
      setImportSkipped(res.skipped || []);
      if (!parsed.length) { setImportErr(new Error('No lab values could be read. Check the format or enter rows by hand.')); return; }
      // Replace a blank starter grid; otherwise append onto what's already there.
      setRows((rs) => {
        const existing = rs.filter((r) => r.marker.trim() || r.value !== '');
        return [...existing, ...parsed];
      });
    } catch (err) { setImportErr(err); } finally { setImporting(false); }
  }

  function onImportFile(text, name) {
    setImportText(text);
    setImportName(name || '');
    setImportErr(null);
    runImport(text);
  }

  async function submit(e) {
    e.preventDefault();
    if (!clientId) return;
    const values = rows
      .filter((r) => r.marker.trim() && r.value !== '')
      .map((r) => ({ marker: r.marker.trim(), value: r.value, unit: r.unit || null, refLow: r.refLow === '' ? null : r.refLow, refHigh: r.refHigh === '' ? null : r.refHigh }));
    if (!values.length) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await api.createLabResult({ clientId, panelId, fasting: fasting === 'true', values });
      setRows([emptyRow()]);
      resultsQ.reload();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Lab Results"
        description="Enter results against the lab report's own reference ranges. Out-of-range values surface as 'review with your provider' — never a diagnosis."
        actions={<StatusChip tone="accent" label="Provider Review Suggested" />}
      />

      <div className="mb-5 max-w-xs">
        <ClientPicker value={clientId} onChange={setClientId} autoSelectFirst />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <TestTubes className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Enter a result</CardTitle>
              <CardDescription>Ranges are the lab report's own. The flag is computed at read time — no clinical judgement is baked in.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Panel id">
                  <Input value={panelId} onChange={(e) => setPanelId(e.target.value)} placeholder="baseline" />
                </FormField>
                <FormField label="Fasting">
                  <Select value={fasting} onChange={(e) => setFasting(e.target.value)}>
                    <option value="true">Fasting</option>
                    <option value="false">Non-fasting</option>
                  </Select>
                </FormField>
              </div>

              {/* Drag-drop / paste import — same local-first reader the Nutrition module uses. The file
                  is read in the browser; only the extracted text is parsed. Manual entry stays the default. */}
              <div className="rounded-lg border border-border-soft bg-muted/30">
                <button
                  type="button"
                  onClick={() => setShowImport((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Upload className="h-4 w-4 text-primary" /> Import from a lab export
                  </span>
                  <span className="text-2xs text-faint">{showImport ? 'Hide' : 'Drag & drop, or paste'}</span>
                </button>
                {showImport && (
                  <div className="space-y-3 border-t border-border-soft p-3">
                    <DropZone onText={onImportFile} onError={setImportErr} fileName={importName} busy={importing} compact />
                    <div>
                      <Textarea
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        rows={4}
                        placeholder={'Or paste lab rows here — e.g.\nGlucose, 5.6, mmol/L, 3.9, 5.5'}
                        className="font-data text-xs"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <Button type="button" size="sm" onClick={() => runImport()} disabled={importing || !importText.trim()}>
                          {importing ? 'Reading…' : 'Extract rows'}
                        </Button>
                        <span className="text-2xs text-faint">Read in your browser — the file is never uploaded.</span>
                      </div>
                    </div>
                    {importErr && <ErrorState error={importErr} />}
                    {importSkipped.length > 0 && (
                      <details className="text-2xs text-faint">
                        <summary className="cursor-pointer select-none">{importSkipped.length} line(s) couldn't be read — skipped</summary>
                        <ul className="mt-1 space-y-0.5 font-data">
                          {importSkipped.map((s, i) => <li key={i} className="truncate">{s}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1.5 grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] gap-2 px-1 text-2xs font-semibold uppercase tracking-wide text-faint">
                  <span>Marker</span><span>Value</span><span>Unit</span><span>Ref low</span><span>Ref high</span><span />
                </div>
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.7fr_auto] gap-2">
                      <Input value={r.marker} onChange={setRow(i, 'marker')} placeholder="Glucose" />
                      <Input value={r.value} onChange={setRow(i, 'value')} placeholder="5.6" type="number" step="any" />
                      <Input value={r.unit} onChange={setRow(i, 'unit')} placeholder="mmol/L" />
                      <Input value={r.refLow} onChange={setRow(i, 'refLow')} placeholder="3.9" type="number" step="any" />
                      <Input value={r.refHigh} onChange={setRow(i, 'refHigh')} placeholder="5.5" type="number" step="any" />
                      <Button type="button" variant="ghost" size="icon" onClick={() => delRow(i)} aria-label="Remove row">
                        <Trash2 className="h-4 w-4 text-faint" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="subtle" size="sm" className="mt-2" onClick={addRow}>
                  <Plus className="h-3.5 w-3.5" /> Add marker
                </Button>
              </div>

              {saveErr && <ErrorState error={saveErr} />}
              <div className="flex justify-end">
                <Button type="submit" disabled={saving || !clientId}>{saving ? 'Saving…' : 'Record result'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Result history</CardTitle>
            <CardDescription>Flagged values route to a provider-review suggestion.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!clientId ? (
              <EmptyState title="Select a client" hint="Pick a client to view and enter results." icon={TestTubes} />
            ) : resultsQ.loading ? (
              <Loading />
            ) : resultsQ.error ? (
              <ErrorState error={resultsQ.error} />
            ) : results.length === 0 ? (
              <EmptyState title="No results yet" hint="Record the first result with the form." icon={TestTubes} />
            ) : (
              results.map((res) => (
                <div key={res.id} className="rounded-md border border-border-soft p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-data text-2xs text-faint">{res.id}</span>
                    {res.hasFlags ? (
                      <StatusChip tone="danger" label={`${res.flags.length} flagged`} />
                    ) : (
                      <StatusChip tone="success" label="All in range" />
                    )}
                  </div>
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Marker</TH><TH>Value</TH><TH>Range</TH><TH>Flag</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {res.values.map((v, i) => (
                        <TR key={i} className="hover:bg-transparent">
                          <TD className="text-foreground">{v.marker}</TD>
                          <TD className="font-data text-xs">{v.value}{v.unit ? ` ${v.unit}` : ''}</TD>
                          <TD className="font-data text-2xs text-faint">{v.refLow ?? '–'}–{v.refHigh ?? '–'}</TD>
                          <TD><StatusChip tone={FLAG_TONE[v.flag] || 'neutral'} label={String(v.flag).replace(/_/g, ' ')} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  {res.hasFlags ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning-soft p-2.5 text-xs text-warning">
                      <Stethoscope className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Review with your provider — this is not a diagnosis.</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5 text-2xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Every value sits within the report's reference range.
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
