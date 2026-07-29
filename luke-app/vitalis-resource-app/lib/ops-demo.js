/**
 * ops-demo.js — Order Ops SIMULATION seed (app-local, not clinical canon).
 *
 * "This is a simulation, for Research purposes. Not actual representation."
 *
 * Builds clearly-labeled demo records for the internal Order Ops surface so the operator
 * dashboard is useful on first boot instead of all-zeros. EVERY record carries `_demo: true`.
 * Products + pricing come ONLY from the canonical protocol-core catalog (no parallel product
 * list, no invented economics). Names/phones/emails are obviously fake (the 555-01xx reserved
 * range, example.com). There is NO real customer, NO real order history, no automatic price
 * reductions, and nothing here is ever sent — invoices are copy/draft-only (handled in server.js).
 *
 * Dates are RELATIVE to seed time so the dashboard stays useful (and MTD/YTD non-zero) whenever
 * it is seeded: one order is dated "today" to guarantee non-zero MTD + YTD, the rest are spread
 * back over the year.
 */
'use strict';

// Canonical catalog via the package's exports-safe barrel (same path server.js uses); the raw
// `catalog.products` carry internal economics (cost) — fine here, the ops surface is admin-gated.
const { catalog: catalogData } = require('@vitalis/protocol-core/data');

function round(n) { return +Number(n || 0).toFixed(2); }

function buildOpsDemo(now = new Date()) {
  const iso = (d) => d.toISOString();
  const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };

  // Canonical catalog only — first 10 AVAILABLE products that carry real economics.
  const pool = (catalogData.products || [])
    .filter((p) => p.availability !== 'UNAVAILABLE' && (p.cost || 0) > 0 && ((p.msrp || p.boxPrice || 0) > 0))
    .slice(0, 10);
  const P = (i) => pool[i];
  const priceOf = (p) => p.msrp || p.boxPrice || 0;

  // --- Customers (obviously fake) -------------------------------------------
  const customers = [
    { id: 'ops_cust_demo_1', name: 'Avery Stone (DEMO)',  email: 'avery.demo@example.com',  phone: '+15550100001', notes: 'Simulation customer', totalSpend: 0, orderCount: 0, creditBalance: 0, createdAt: iso(daysAgo(120)), _demo: true },
    { id: 'ops_cust_demo_2', name: 'Briar Quinn (DEMO)',  email: 'briar.demo@example.com',  phone: '+15550100002', notes: 'Simulation customer', totalSpend: 0, orderCount: 0, creditBalance: 0, createdAt: iso(daysAgo(95)),  _demo: true },
    { id: 'ops_cust_demo_3', name: 'Cleo Marsh (DEMO)',   email: 'cleo.demo@example.com',   phone: '+15550100003', notes: 'Simulation customer', totalSpend: 0, orderCount: 0, creditBalance: 0, createdAt: iso(daysAgo(60)),  _demo: true },
  ];

  // --- Inventory (10 catalog products; a mix incl. low stock ≤ 2) -----------
  const onHandPlan = [14, 9, 2, 6, 1, 22, 7, 11, 3, 18];
  const inventory = pool.map((p, i) => ({
    id: `ops_inv_demo_${i + 1}`, productId: p.id, sku: p.sku, name: p.name || p.displayName,
    onHand: onHandPlan[i] != null ? onHandPlan[i] : 6, updatedAt: iso(daysAgo(30)), _demo: true,
  }));

  // --- Orders (4–6 across PAID / PARTIAL / UNPAID; today-dated #1 → MTD>0) ---
  let invoiceSeq = 1;
  function makeOrder({ idn, customer, picks, when, pay }) {
    const items = picks.map(({ p, qty }) => {
      const price = priceOf(p); const cost = p.cost || 0;
      return {
        productId: p.id, sku: p.sku, name: p.name || p.displayName, qty, price, cost,
        lineTotal: round(qty * price), lineCost: round(qty * cost), lineProfit: round(qty * (price - cost)), _demo: true,
      };
    });
    const subtotal = round(items.reduce((s, it) => s + it.lineTotal, 0));
    const costTotal = round(items.reduce((s, it) => s + it.lineCost, 0));
    const total = subtotal;                 // no account credit applied on demo orders; prices owner-set
    const grossProfit = round(total - costTotal);
    const marginPct = total > 0 ? round((grossProfit / total) * 100) : 0;
    const amountPaid = pay === 'PAID' ? total : pay === 'PARTIAL' ? round(total * 0.5) : 0;
    const balanceDue = round(total - amountPaid);
    const paymentStatus = balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID';
    const createdAt = iso(when);
    return {
      id: `ops_ord_demo_${idn}`, invoiceNumber: `VIT-${String(invoiceSeq++).padStart(4, '0')}`,
      customerId: customer.id, customerName: customer.name,
      items, subtotal, accountCreditApplied: 0,
      total, amountPaid, balanceDue, costTotal, grossProfit, marginPct,
      paymentStatus, invoiceStatus: paymentStatus === 'PAID' ? 'PAID' : 'DRAFT',
      createdAt, updatedAt: createdAt, _demo: true,
    };
  }

  const orders = [
    makeOrder({ idn: 1, customer: customers[0], picks: [{ p: P(5), qty: 1 }, { p: P(1), qty: 2 }], when: now,          pay: 'PAID' }),
    makeOrder({ idn: 2, customer: customers[1], picks: [{ p: P(8), qty: 1 }],                       when: daysAgo(8),  pay: 'PARTIAL' }),
    makeOrder({ idn: 3, customer: customers[0], picks: [{ p: P(0), qty: 1 }, { p: P(6), qty: 1 }], when: daysAgo(18), pay: 'UNPAID' }),
    makeOrder({ idn: 4, customer: customers[2], picks: [{ p: P(9), qty: 1 }],                       when: daysAgo(40), pay: 'PAID' }),
    makeOrder({ idn: 5, customer: customers[1], picks: [{ p: P(5), qty: 2 }, { p: P(1), qty: 1 }], when: daysAgo(70), pay: 'PAID' }),
  ];

  // Roll customer stats up from their orders (booked totals).
  for (const c of customers) {
    const mine = orders.filter((o) => o.customerId === c.id);
    c.orderCount = mine.length;
    c.totalSpend = round(mine.reduce((s, o) => s + o.total, 0));
  }

  // --- Referral credit account + ledger -------------------------------------
  // Referrer earns ACCOUNT CREDIT (no %/profit/cost exposed — matches the Vitalis referral rule).
  const refAcct = {
    id: 'ops_ref_demo_1', customerId: customers[0].id, customerName: customers[0].name,
    creditBalance: 45, totalEarned: 60, totalRedeemed: 15, createdAt: iso(daysAgo(50)), _demo: true,
  };
  const refLedger = [
    { id: 'ops_rled_demo_1', referralAccountId: refAcct.id, type: 'CREDIT', amount: 60, reason: 'Referral reward (simulation)',                 orderId: null,         createdAt: iso(daysAgo(50)), _demo: true },
    { id: 'ops_rled_demo_2', referralAccountId: refAcct.id, type: 'DEBIT',  amount: 15, reason: 'Credit applied to a prior order (simulation)', orderId: orders[4].id, createdAt: iso(daysAgo(45)), _demo: true },
  ];

  // --- Supplier orders (1 Biogenix w/ balance · 1 JH Strong paid+received) ---
  function supplierItems(picks) {
    return picks.map(({ p, qty }) => ({
      productId: p.id, name: p.name || p.displayName, qty, unitCost: p.cost || 0, lineTotal: round(qty * (p.cost || 0)), _demo: true,
    }));
  }
  const so1Items = supplierItems([{ p: P(2), qty: 5 }, { p: P(0), qty: 5 }]);
  const so1Total = round(so1Items.reduce((s, it) => s + it.lineTotal, 0));
  const so1Paid = round(so1Total * 0.5);
  const so2Items = supplierItems([{ p: P(5), qty: 10 }, { p: P(6), qty: 10 }]);
  const so2Total = round(so2Items.reduce((s, it) => s + it.lineTotal, 0));
  const supplierOrders = [
    { id: 'ops_supp_demo_1', supplier: 'Biogenix',  items: so1Items, totalCost: so1Total, amountPaid: so1Paid,  balanceDue: round(so1Total - so1Paid), paymentStatus: 'PARTIAL', orderStatus: 'ORDERED',  notes: 'Simulation supplier order',             createdAt: iso(daysAgo(25)), updatedAt: iso(daysAgo(25)), _demo: true },
    { id: 'ops_supp_demo_2', supplier: 'JH Strong', items: so2Items, totalCost: so2Total, amountPaid: so2Total, balanceDue: 0,                         paymentStatus: 'PAID',    orderStatus: 'RECEIVED', notes: 'Simulation supplier order (received)',  createdAt: iso(daysAgo(35)), updatedAt: iso(daysAgo(33)), _demo: true },
  ];

  // --- Inventory movements (SALE per order item · RESTOCK for received SO2) --
  const movements = [];
  let movSeq = 1;
  for (const o of orders) {
    for (const it of o.items) {
      movements.push({ id: `ops_mov_demo_${movSeq++}`, productId: it.productId, type: 'SALE', qty: -it.qty, reason: `Order ${o.invoiceNumber}`, orderId: o.id, supplierOrderId: null, createdAt: o.createdAt, _demo: true });
    }
  }
  for (const it of so2Items) {
    movements.push({ id: `ops_mov_demo_${movSeq++}`, productId: it.productId, type: 'RESTOCK', qty: it.qty, reason: 'Received supplier order ops_supp_demo_2', orderId: null, supplierOrderId: 'ops_supp_demo_2', createdAt: iso(daysAgo(33)), _demo: true });
  }

  return {
    opsCustomers: customers,
    opsOrders: orders,
    opsInventory: inventory,
    opsInventoryMovements: movements,
    opsSupplierOrders: supplierOrders,
    opsReferralAccounts: [refAcct],
    opsReferralLedger: refLedger,
  };
}

module.exports = { buildOpsDemo };
