/**
 * opsShared.jsx — small shared helpers + the invoice-handoff panel for the Order Ops sub-screens.
 *
 * Internal/operator surface only. The exact simulation banner string lives here so every sub-screen
 * renders the SAME text (it is shown once in OrderOpsLayout, above the tab outlet). Reuses the
 * app's existing UI primitives — no second design system. No live SMS/Telegram send: the handoff
 * only ever produces copyable text + sms:/Telegram DRAFT links the operator reviews and sends by hand.
 */
import { ClipboardCopy, MessageSquare, Printer, Send, ReceiptText } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/States.jsx';

export const OPS_BANNER = 'This is a simulation, for Research purposes. Not actual representation.';

export const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
export const today = () => new Date().toISOString().slice(0, 10);

// Order-Ops payment/fulfilment statuses → restrained Badge tone (distinct from the gate StatusChip
// map, which is for clinical gate states). PAID/RECEIVED = good, PARTIAL/ORDERED = caution, UNPAID = bad.
export function opsStatusTone(status) {
  if (status === 'PAID' || status === 'RECEIVED') return 'success';
  if (status === 'PARTIAL' || status === 'PARTIAL_RECEIVED' || status === 'ORDERED') return 'warning';
  if (status === 'UNPAID') return 'danger';
  return 'neutral';
}

// Invoice handoff — copy / print / SMS-draft / Telegram-share. NEVER a live send.
export function InvoiceHandoff({ invoice, onMessage }) {
  if (!invoice) {
    return <EmptyState title="No invoice loaded" hint="Create an order, or open one from the Orders tab, to generate copyable invoice text." icon={ReceiptText} />;
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(invoice.plainText); onMessage && onMessage('Invoice text copied.'); }
    catch { onMessage && onMessage('Copy not available — select the text manually.'); }
  };
  const print = () => {
    const w = window.open('', '_blank', 'width=720,height=800');
    if (!w) return;
    const safe = invoice.plainText.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    w.document.write(`<pre style="font-family:Inter,Arial,sans-serif;white-space:pre-wrap;padding:32px">${safe}</pre>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <div className="space-y-3">
      <textarea readOnly value={invoice.plainText} className="h-64 w-full rounded-md border border-border bg-muted/30 p-3 font-data text-xs text-foreground" />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={print}><Printer className="h-4 w-4" /> Print</Button>
        <Button variant="outline" onClick={copy}><ClipboardCopy className="h-4 w-4" /> Copy</Button>
        <a className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted" href={invoice.smsUrl}><MessageSquare className="h-4 w-4" /> SMS Draft</a>
        <a className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted" href={invoice.telegramUrl} target="_blank" rel="noreferrer"><Send className="h-4 w-4" /> Telegram</a>
      </div>
      <p className="text-2xs text-faint">No live send. Copy/print, or open an SMS / Telegram <strong>draft</strong> to review before sending manually.</p>
    </div>
  );
}
