/**
 * OrderOpsReferrals (/admin/orders/referrals) — referral ACCOUNT-CREDIT accounts + ledger. Each
 * account has an "Adjust" row action that opens a compact inline editor (amount + reason + Credit /
 * Debit) — no window.prompt. The referrer earns account credit only — no %, profit, cost, or order
 * value is ever shown here (matches the Vitalis referral rule). No discount logic.
 */
import { useEffect, useState } from 'react';
import { WalletCards } from 'lucide-react';
import api from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/ui/States.jsx';
import { money } from './opsShared.jsx';

export default function OrderOpsReferrals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Inline adjust editor (replaces window.prompt): which account + amount + reason + validation.
  const [adjFor, setAdjFor] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState('');

  async function load() {
    setError(null);
    try { const res = await api.opsReferrals(); setData(res); }
    catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, []);

  const accounts = (data && data.accounts) || [];
  const ledger = (data && data.ledger) || [];
  const adjAccount = accounts.find((a) => a.id === adjFor) || null;

  function openAdj(acct) { setAdjFor(acct.id); setAmount(''); setReason(''); setFieldError(''); }
  function cancelAdj() { setAdjFor(''); setAmount(''); setReason(''); setFieldError(''); }

  async function apply(acct, type) {
    const amt = Number(amount);
    if (amount === '' || Number.isNaN(amt) || amt <= 0) { setFieldError('Enter a positive amount.'); return; }
    const reasonText = reason.trim() || `Manual ${type.toLowerCase()}`;
    setBusy(true);
    try {
      if (type === 'CREDIT') await api.opsReferralCredit(acct.id, { amount: amt, reason: reasonText });
      else await api.opsReferralDebit(acct.id, { amount: amt, reason: reasonText });
      await load();
      setMessage(`${type === 'CREDIT' ? 'Credited' : 'Debited'} ${money(amt)} ${type === 'CREDIT' ? 'to' : 'from'} ${acct.customerName}.`);
      cancelAdj();
    } catch (e) { setMessage(e.message || 'Adjustment failed.'); } finally { setBusy(false); }
  }

  if (data == null && !error) return <Loading label="Loading referral credits…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-md border border-success/20 bg-success-soft px-3 py-1.5 text-sm text-success">{message}</div>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><WalletCards className="h-4 w-4 text-primary" /> Accounts</CardTitle><CardDescription>Account credit only — applied automatically to the customer's next order.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            {adjAccount && (
              <div className="mx-5 mb-3 rounded-md border border-border bg-muted/40 p-3">
                <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-faint">Adjust credit · {adjAccount.customerName}</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-2xs font-medium text-soft">
                    <span>Amount</span>
                    <Input
                      type="number" min="0" step="0.01" value={amount} autoFocus className="w-28"
                      onChange={(e) => { setAmount(e.target.value); if (fieldError) setFieldError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Escape') cancelAdj(); }}
                    />
                  </label>
                  <label className="grid min-w-[160px] flex-1 gap-1 text-2xs font-medium text-soft">
                    <span>Reason</span>
                    <Input value={reason} placeholder="Manual adjustment" onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <Button size="sm" onClick={() => apply(adjAccount, 'CREDIT')} disabled={busy}>Credit</Button>
                  <Button size="sm" variant="outline" onClick={() => apply(adjAccount, 'DEBIT')} disabled={busy}>Debit</Button>
                  <Button size="sm" variant="ghost" onClick={cancelAdj} disabled={busy}>Cancel</Button>
                </div>
                {fieldError && <p className="mt-1.5 text-2xs text-danger">{fieldError}</p>}
              </div>
            )}
            <Table>
              <THead><TR><TH className="pl-5">Account</TH><TH>Balance</TH><TH>Earned</TH><TH>Redeemed</TH><TH className="pr-5" /></TR></THead>
              <TBody>
                {accounts.map((r) => (
                  <TR key={r.id} className={adjFor === r.id ? 'bg-muted/30' : undefined}>
                    <TD className="pl-5 text-foreground">{r.customerName}</TD>
                    <TD className="font-data text-foreground">{money(r.creditBalance)}</TD>
                    <TD className="font-data">{money(r.totalEarned)}</TD>
                    <TD className="font-data">{money(r.totalRedeemed)}</TD>
                    <TD className="whitespace-nowrap pr-5 text-right">
                      <Button variant={adjFor === r.id ? 'subtle' : 'ghost'} size="sm" onClick={() => (adjFor === r.id ? cancelAdj() : openAdj(r))} disabled={busy}>Adjust</Button>
                    </TD>
                  </TR>
                ))}
                {!accounts.length && <TR><TD colSpan={5}><EmptyState title="No referral accounts yet" icon={WalletCards} /></TD></TR>}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ledger</CardTitle><CardDescription>Newest first.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-1">
            <Table>
              <THead><TR><TH className="pl-5">Date</TH><TH>Type</TH><TH>Amount</TH><TH className="pr-5">Reason</TH></TR></THead>
              <TBody>
                {[...ledger].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map((l) => (
                  <TR key={l.id}>
                    <TD className="pl-5 text-2xs text-soft">{String(l.createdAt || '').slice(0, 10)}</TD>
                    <TD><Badge tone={l.type === 'CREDIT' ? 'success' : 'warning'}>{l.type}</Badge></TD>
                    <TD className="font-data">{money(l.amount)}</TD>
                    <TD className="pr-5 text-2xs text-soft">{l.reason}</TD>
                  </TR>
                ))}
                {!ledger.length && <TR><TD colSpan={4}><EmptyState title="No ledger entries yet" icon={WalletCards} /></TD></TR>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
