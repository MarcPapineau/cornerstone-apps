import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, FileText, UserCog, ScrollText, FlaskConical, ArrowRight, BadgeCheck } from 'lucide-react';
import { useFetch } from '../lib/useApi.js';
import api from '../lib/api.js';
import { useRole } from '../lib/roleContext.jsx';
import { fmtDate } from '../lib/utils.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { StatusChip } from '../components/ui/StatusChip.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../components/ui/Table.jsx';
import { FormField, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { Loading, ErrorState, EmptyState } from '../components/ui/States.jsx';
import DropZone from '../components/ui/DropZone.jsx';

const KINDS = ['LAB_REPORT', 'INTAKE', 'IMAGING', 'OTHER'];
const EMPTY = { label: '', kind: 'LAB_REPORT', fileName: '', textExcerpt: '' };

export default function PortalDocuments() {
  const { clientId } = useRole();
  const q = useFetch(() => (clientId ? api.clientDocuments(clientId) : Promise.resolve(null)), [clientId]);
  const protoQ = useFetch(() => (clientId ? api.clientProtocols(clientId) : Promise.resolve(null)), [clientId]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      await api.uploadDocument(clientId, {
        label: form.label,
        kind: form.kind,
        fileName: form.fileName || null,
        textExcerpt: form.textExcerpt || null,
        uploadedBy: 'CLIENT',
      });
      setForm(EMPTY);
      q.reload();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="My Documents" description="Keep your lab reports, intake forms and other records in one place — to review with your practitioner." />
        <Card><CardContent className="py-10"><EmptyState title="No client selected" hint="Pick a client in the “View as” switcher." icon={UserCog} /></CardContent></Card>
      </>
    );
  }

  const documents = q.data?.documents || [];
  // Deep-link ONLY the client's APPROVED protocol dossiers. clientProtocols is already the
  // approval-gated projection (clientVisibleProtocols drops every un-approved draft), so the
  // current/past id here is always an approved protocol draftId — safe to open with ?role=CLIENT.
  // The peptide protocol AND its bloodwork requisition are both keyed by this same protocol id.
  const approvedProtocol = protoQ.data?.current?.[0] || protoQ.data?.past?.[0] || null;
  const approvedProtocolId = approvedProtocol?.id || null;

  return (
    <>
      <PageHeader
        title="My Documents"
        description="Keep your lab reports, intake forms and other records together — an educational reference to review with your practitioner. Vitalis does not diagnose."
        actions={<Badge tone="neutral">{documents.length}</Badge>}
      />

      {approvedProtocolId && (
        <Card className="mb-5">
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <BadgeCheck className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Approved Vitalis documents</CardTitle>
              <CardDescription>The dossiers your practitioner approved as an educational resource — open them to read or save as PDF.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to={`/document/peptide/${encodeURIComponent(approvedProtocolId)}?role=CLIENT`}
              className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-3 py-2.5 transition hover:border-gold/40 hover:bg-muted/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-gold"><ScrollText className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">Peptide protocol</span>
                <span className="block truncate text-2xs text-soft">{approvedProtocol.title || approvedProtocol.goal || 'Your approved protocol dossier'}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">Open <ArrowRight className="h-3.5 w-3.5" /></span>
            </Link>
            <Link
              to={`/document/blood_req/${encodeURIComponent(approvedProtocolId)}?role=CLIENT`}
              className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-3 py-2.5 transition hover:border-gold/40 hover:bg-muted/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-gold"><FlaskConical className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">Bloodwork requisition</span>
                <span className="block truncate text-2xs text-soft">The panels to ask your provider for — baseline plus your protocol markers.</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">Open <ArrowRight className="h-3.5 w-3.5" /></span>
            </Link>
            <p className="text-2xs leading-relaxed text-faint">These are educational research resources your practitioner reviewed — not a prescription, and not a diagnosis.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-primary">
              <FilePlus2 className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle>Add a document</CardTitle>
              <CardDescription>Record the details, and optionally bring in a text export to keep alongside it.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <FormField label="Label">
                <Input value={form.label} onChange={set('label')} placeholder="e.g. Baseline panel — Jan 2026" required />
              </FormField>
              <FormField label="Kind">
                <Select value={form.kind} onChange={set('kind')}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Bring in a file" hint="CSV, TSV, or plain text — read in your browser.">
                <DropZone
                  compact
                  onText={(text, fileName) => setForm((f) => ({ ...f, textExcerpt: text, fileName }))}
                  onError={(e) => setSaveErr(new Error(typeof e === 'string' ? e : 'Could not read file'))}
                  fileName={form.fileName}
                />
              </FormField>
              <FormField label="Paste text (optional)">
                <Textarea value={form.textExcerpt} onChange={set('textExcerpt')} placeholder="Paste the contents of your report here, or use the file picker above." />
              </FormField>
              <p className="text-2xs text-faint">
                Files are read in your browser and never uploaded to a third party — we keep the document details and any text you bring in.
              </p>
              {saveErr && <ErrorState error={saveErr} />}
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={saving || !form.label.trim()}>
                  {saving ? 'Saving…' : 'Add document'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Your documents</CardTitle>
            <CardDescription>Everything you and your practitioner have added, newest details first.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-1">
            {q.loading ? (
              <Loading label="Loading your documents…" />
            ) : q.error ? (
              <div className="px-5"><ErrorState error={q.error} /></div>
            ) : documents.length === 0 ? (
              <EmptyState title="No documents yet" hint="Add your first record with the form on the left." icon={FileText} />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="pl-5">Document</TH>
                    <TH>Kind</TH>
                    <TH>Status</TH>
                    <TH className="pr-5">Added</TH>
                  </TR>
                </THead>
                <TBody>
                  {documents.map((d) => (
                    <TR key={d.id}>
                      <TD className="pl-5">
                        <div className="font-medium text-foreground">{d.label}</div>
                        {d.fileName && <div className="mt-0.5 font-data text-2xs text-faint">{d.fileName}</div>}
                      </TD>
                      <TD>
                        <Badge tone="neutral">{d.kind}</Badge>
                      </TD>
                      <TD>
                        <StatusChip status={d.status} />
                      </TD>
                      <TD className="pr-5 text-xs text-faint">{fmtDate(d.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
