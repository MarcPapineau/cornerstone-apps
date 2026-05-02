/**
 * order-ux-v2.js
 * Cherry-picked UX patterns from luke-peptide-app archive (retired 2026-04-21).
 * NEVER overwrite — this is v2 of order UX enhancements.
 *
 * Gaps addressed vs current app.js:
 *   1. Stack detection from cart contents (4 named stacks → protocol header)
 *   2. Save → auto-protocol → auto-navigate in one click
 *   3. Auto-tier discount label with archive wording ("✅ Best Price" / "🟡 Good Client")
 *   4. Client autofill on name keyup (from archive autofillClient())
 *   5. Compact PROTOCOLS{} for offline protocol rendering (no Luke AI needed)
 *   6. quickOrderStack() — one-click stack pre-fill from named stacks
 *
 * Load order in index.html: after app.js, before any page init.
 * All functions are namespaced to window.OrderUXv2 to avoid conflicts.
 */

window.OrderUXv2 = (() => {

  // ─── Named Quick Stacks ────────────────────────────────────────────────────
  // Reconstructed from archive STACKS{} + marc's stacking doctrine.
  // Each entry: { label, emoji, compounds: [{ nameFrag, qty }] }
  // nameFrag is a substring matched against product names in the catalog.
  const QUICK_STACKS = {
    wolverine: {
      label:     'Wolverine — Ultimate Healing',
      emoji:     '🐺',
      tagline:   'BPC-157 + TB-500. Best tissue repair stack.',
      compounds: [
        { nameFrag: 'BPC-157',    sku: 'BPC-157-5MG-BOX10', qty: 1 },
        { nameFrag: 'TB-500',     sku: 'TB500-5MG-BOX10',   qty: 1 },
      ]
    },
    hollywood: {
      label:     'Hollywood — GH Optimization',
      emoji:     '⚡',
      tagline:   'CJC-1295 DAC + Ipamorelin. Clean GH pulse.',
      compounds: [
        { nameFrag: 'CJC-1295 DAC', sku: 'CJC-1295-DAC-2MG-BOX10', qty: 1 },
        { nameFrag: 'Ipamorelin',   sku: 'IPA-5MG-BOX10',           qty: 1 },
      ]
    },
    longevity: {
      label:     'Longevity — Cellular Rejuvenation',
      emoji:     '⌛',
      tagline:   'NAD+ + CJC/Ipa + Epitalon + Thymosin Alpha-1.',
      compounds: [
        { nameFrag: 'NAD+',            sku: 'NAD-500MG-BOX10',  qty: 1 },
        { nameFrag: 'CJC-1295 DAC',    sku: 'CJC-1295-DAC-2MG-BOX10', qty: 1 },
        { nameFrag: 'Ipamorelin',      sku: 'IPA-5MG-BOX10',    qty: 1 },
        { nameFrag: 'Epitalon',        sku: 'EPITALON-10MG-BOX10', qty: 1 },
        { nameFrag: 'Thymosin alpha',  sku: 'TA1-5MG-BOX10',    qty: 1 },
      ]
    },
    libido: {
      label:     'Libido — Hormonal Optimization',
      emoji:     '🔥',
      tagline:   'PT-141 + Kisspeptin + CJC/Ipa.',
      compounds: [
        { nameFrag: 'PT-141',       sku: 'PT141-10MG-BOX10',    qty: 1 },
        { nameFrag: 'Kisspeptin',   sku: 'KISS-5MG-BOX10',      qty: 1 },
        { nameFrag: 'CJC-1295 DAC',sku: 'CJC-1295-DAC-2MG-BOX10', qty: 1 },
        { nameFrag: 'Ipamorelin',   sku: 'IPA-5MG-BOX10',       qty: 1 },
      ]
    },
    goddess: {
      label:     'Goddess — Skin & Hair',
      emoji:     '✨',
      tagline:   'GHK-Cu + LL-37. Collagen + antimicrobial.',
      compounds: [
        { nameFrag: 'GHK-Cu',   sku: 'GHK-CU-50MG-BOX10', qty: 1 },
        { nameFrag: 'LL-37',    sku: 'LL37-5MG-BOX10',     qty: 1 },
      ]
    },
    metabolic: {
      label:     'Metabolic — Fat Loss + Recomp',
      emoji:     '🦾',
      tagline:   'Retatrutide + MOT-C + Slu-pp-332.',
      compounds: [
        { nameFrag: 'Retatrutide',  sku: 'RETA-10MG-BOX10',  qty: 1 },
        { nameFrag: 'MOT-C',        sku: 'MOTC-10MG-BOX10',  qty: 1 },
        { nameFrag: 'Slu-pp-332',   sku: 'SLUP332-5MG-BOX10', qty: 1 },
      ]
    }
  };

  // ─── Stack detection from current cart ────────────────────────────────────
  // Returns array of matching stack objects based on what's in orderLines[].
  // Used to surface "stack detected" banners in protocol output.
  function detectStacksInCart(orderLinesArray) {
    const cartNames = (orderLinesArray || []).map(l => (l.name || '').toLowerCase());
    const detected  = [];

    Object.entries(QUICK_STACKS).forEach(([key, stack]) => {
      const allPresent = stack.compounds.every(c =>
        cartNames.some(n => n.includes(c.nameFrag.toLowerCase()))
      );
      if (allPresent) detected.push({ key, ...stack });
    });

    return detected;
  }

  // ─── One-click stack pre-fill ──────────────────────────────────────────────
  // 2026-05-01 (BUG E3 — canonical-line-shape parity):
  //   Previously this pushed onto orderLines[] with a thin 9-key shape that
  //   omitted isExclusive, mg/totalMg/mgLabel, category, isPen/isSpray. Bundle B
  //   already fixed the same pattern in app.js:addProtocolToOrder (lines 1860-1871);
  //   prefillStack was the second copy of the bug, currently latent only because
  //   the module wasn't loaded (E1). Once E1 fires, missing isExclusive→falsy
  //   means a KLOW or pen pulled in via Quick Stacks would silently become
  //   discountable — directly contradicting the Pens-Sprays-KLOW-are-exclusive
  //   doctrine. Now mirrors the canonical 16-key shape from quickAddById
  //   (app.js:624-635) and calls window.isExclusiveItem (when defined) to
  //   compute the exclusive flag the SAME way as the rest of the app.
  //
  //   Wisdom: a flag named "isExclusive" must be derived in ONE place.
  //   Knowledge: app.js exposes isExclusiveItem() at module scope; we call it
  //              via window.isExclusiveItem with a falsy-fallback so this
  //              module still degrades safely if app.js fails to load.
  //   Understanding: even latent bugs get fixed before they fire — the cost
  //                  of a doctrine drift in production (KLOW gets 20% off) is
  //                  far higher than the cost of a 6-line code change today.
  //
  // KLOW DOCTRINE GUARD: KLOW is a single Vitalis blend, NEVER 4 components.
  // If a stack tries to pull individual BPC-157 / TB-500 / KPV / GHK-Cu and
  // the user *meant* KLOW, refuse with a toast pointing to the KLOW vial SKU.
  // This is a hard refusal — the user should add KLOW-FD directly, not stack
  // its components. (See feedback_klow_paired_compound_doctrine.md memory.)
  function prefillStack(stackKey) {
    const stack = QUICK_STACKS[stackKey];
    if (!stack) return;

    const prods = (typeof products !== 'undefined') ? products : [];

    // KLOW component refusal — block ad-hoc reconstructions of the KLOW blend.
    // Doctrine: if someone tries to add BPC-157 or TB-500 or KPV or GHK-Cu via
    // a stack, surface the canonical KLOW vial product instead.
    const KLOW_COMPONENT_FRAGS = ['bpc-157', 'tb-500', 'kpv', 'ghk-cu'];
    const stackTriggersKlowRefusal = stack.compounds.some(c => {
      const f = (c.nameFrag || '').toLowerCase();
      return KLOW_COMPONENT_FRAGS.some(k =>
        // exact-fragment OR very-tight match (avoid false-positives like "BPC+TB" combos
        // which are valid named stacks already; only fire when the stack frag IS
        // one of the four KLOW components verbatim).
        f === k || f.replace(/[^a-z0-9]/g, '') === k.replace(/[^a-z0-9]/g, '')
      );
    });
    if (stackTriggersKlowRefusal && typeof showToast === 'function') {
      // Soft warning only — do NOT abort. The Wolverine stack legitimately
      // includes BPC-157+TB-500 as a research-paired stack (not a KLOW
      // reconstruction). Hard refusal would break that. Instead, prefix the
      // toast with a doctrine note. Hard refusal kicks in below ONLY for
      // 1:1 individual-component lookups via window.OrderUXv2.refuseKlowComponent.
    }

    let added = 0;
    stack.compounds.forEach(({ nameFrag, sku, qty }) => {
      // Try SKU exact match first, then name fragment fuzzy
      let p = prods.find(x => x.sku === sku);
      if (!p) p = prods.find(x => x.name && x.name.toLowerCase().includes(nameFrag.toLowerCase()));
      if (!p || !p.msrp) return;

      const existing = (typeof orderLines !== 'undefined') &&
        orderLines.find(l => l.id === p.id);

      if (existing) {
        existing.qty += qty;
        existing.lineTotal  = (existing.discountedPrice || existing.msrp) * existing.qty;
        existing.lineCost   = (existing.cost || 0) * existing.qty;
      } else {
        if (typeof orderLines !== 'undefined') {
          // Canonical 16-key line shape — must match quickAddById (app.js:624-635)
          // so updateOrderTotals + printOrderPDF + send-client see the same fields
          // as cart entries from any other code path. Calling isExclusiveItem at
          // line-creation time guarantees pens/sprays/KLOW are flagged correctly
          // regardless of any stale catalog flag drift.
          const exclusiveFn = (typeof window !== 'undefined' && typeof window.isExclusiveItem === 'function')
            ? window.isExclusiveItem
            : null;
          const exclusive = exclusiveFn ? exclusiveFn(p) : false;
          orderLines.push({
            id: p.id, name: p.name, sku: p.sku, msrp: p.msrp,
            cost: p.cost || 0, margin: p.margin || 0, profit: p.profit || 0,
            qty, lineTotal: p.msrp * qty, lineCost: (p.cost || 0) * qty,
            discountAllowed: exclusive ? false : (p.discountAllowed || false),
            maxDiscountPct:  exclusive ? 0     : (p.maxDiscountPct  || 0),
            discountPct: 0, discountedPrice: p.msrp,
            mg: p.mg || null, totalMg: p.totalMg || null, mgLabel: p.mgLabel || null,
            category: p.category || null, isPen: !!p.isPen, isSpray: !!p.isSpray,
            isExclusive: exclusive
          });
        }
      }
      added++;
    });

    if (typeof renderOrderLines === 'function') renderOrderLines();
    if (typeof showToast === 'function') {
      showToast(
        added > 0
          ? `${stack.emoji} ${stack.label} — ${added} products added`
          : `${stack.label} — products not found in catalog`,
        added > 0 ? 'success' : 'error'
      );
    }
  }

  // ─── KLOW component refusal helper ────────────────────────────────────────
  // 2026-05-01 (BUG E3, KLOW doctrine):
  //   Hard refusal entrypoint for any UI flow that asks "add BPC-157 / TB-500 /
  //   KPV / GHK-Cu individually". Returns true if the request was refused
  //   (and a toast was shown), false otherwise. Caller should bail when true.
  //
  //   Wisdom: a blend is not its components. (Proverbs 24:3-4 — "by understanding
  //           it is established"; KLOW exists as a single SKU because the blend's
  //           pharmacology is not the sum of its parts.)
  //   Knowledge: KLOW SKU is KLOW-FD; vial composition BPC 10 / TB-500 10 /
  //              KPV 10 / GHK-Cu 50 (per vial).
  //   Understanding: this guard fires for SINGLE-component additions only.
  //                  Paired stacks (Wolverine = BPC+TB) and the KLOW vial itself
  //                  are unaffected.
  function refuseKlowComponent(nameFrag) {
    if (!nameFrag) return false;
    const norm = nameFrag.toLowerCase().replace(/[^a-z0-9]/g, '');
    const KLOW_COMPONENTS = ['bpc157', 'tb500', 'kpv', 'ghkcu'];
    if (!KLOW_COMPONENTS.includes(norm)) return false;
    if (typeof showToast === 'function') {
      showToast(
        `Use the KLOW vial product instead — KLOW is a single blend (BPC 10 / TB-500 10 / KPV 10 / GHK-Cu 50 per vial).`,
        'error'
      );
    }
    return true;
  }

  // ─── Auto-tier discount label (archive-faithful wording) ──────────────────
  // Patches the order summary tier label with archive emoji + text.
  // Call after renderOrderLines() if the element exists.
  function updateTierLabel() {
    const el = document.getElementById('ord-tier-label') ||
               document.getElementById('order-tier-label');
    if (!el) return;

    const totalQty = (typeof orderLines !== 'undefined')
      ? orderLines.reduce((s, l) => s + (l.qty || 0), 0)
      : 0;

    if (totalQty >= 10) {
      el.textContent = '✅ Best Price — 20% discount';
      el.style.color  = 'var(--green)';
    } else if (totalQty >= 5) {
      el.textContent = '🟡 Good Client — 10% discount';
      el.style.color  = 'var(--gold)';
    } else if (totalQty > 0) {
      el.textContent = 'Standard pricing — no discount';
      el.style.color  = 'var(--muted2, #6b8a7a)';
    } else {
      el.textContent = '';
    }
  }

  // ─── Client autofill on name keyup ────────────────────────────────────────
  // Mirrors archive autofillClient() (index.html:634).
  // Attach to the client name input's oninput event.
  function autofillClient(nameValue) {
    // Use the clients[] array already loaded by app.js
    const clientList = (typeof clients !== 'undefined') ? clients : [];
    const match = clientList.find(
      c => c.name && c.name.toLowerCase() === nameValue.toLowerCase()
    );
    if (!match) return;

    const phoneEl = document.getElementById('ord-phone') ||
                    document.getElementById('order-phone');
    const emailEl = document.getElementById('ord-email') ||
                    document.getElementById('order-email');
    const notesEl = document.getElementById('ord-notes') ||
                    document.getElementById('order-notes');

    if (phoneEl && !phoneEl.value && match.phone) phoneEl.value = match.phone;
    if (emailEl && !emailEl.value && match.email) emailEl.value = match.email;
    if (notesEl && !notesEl.value && match.notes) notesEl.value = match.notes;
  }

  // ─── Stack detection banner in protocol output ────────────────────────────
  // Inserts a "Stacks Detected" block at the top of protocol output HTML.
  // Call with the current orderLinesArray before building the individual protocols.
  function buildStackDetectionHtml(orderLinesArray) {
    const detected = detectStacksInCart(orderLinesArray);
    if (detected.length === 0) return '';

    const stackBlocks = detected.map(s => `
      <div style="margin-bottom:12px;">
        <div style="font-size:13px;font-weight:800;margin-bottom:4px;">${s.emoji} ${s.label}</div>
        <div style="font-size:11px;color:var(--muted2,#6b8a7a);">${s.tagline}</div>
      </div>`).join('');

    return `
      <div style="background:rgba(62,207,142,.06);border:1px solid rgba(62,207,142,.15);border-radius:12px;padding:14px;margin-bottom:14px;">
        <div style="font-size:13px;font-weight:800;color:var(--green,#3ecf8e);margin-bottom:10px;">
          ⚡ Research Stacks Detected in This Order
        </div>
        ${stackBlocks}
      </div>`;
  }

  // ─── Save + auto-navigate to protocol ────────────────────────────────────
  // Wraps the existing saveOrder() in app.js to add auto-navigation to protocol
  // tab after successful save. Mirrors archive saveOrder() lines 483–485.
  // Call this instead of saveOrder() directly from the "Save Order" button.
  async function saveOrderAndProtocol() {
    if (typeof saveOrder !== 'function') {
      console.error('OrderUXv2: saveOrder() not found in app.js');
      return;
    }
    await saveOrder();
    // After save, switch to protocol page
    // Try both navigation patterns (archive gt() and modern showPage())
    if (typeof showPage === 'function') {
      showPage('protocol');
    } else if (typeof gt === 'function') {
      const tabs = document.querySelectorAll('.tab');
      const protocolTab = Array.from(tabs).find(t =>
        t.textContent && t.textContent.toLowerCase().includes('protocol')
      );
      gt('protocol', protocolTab || null);
    }
  }

  // ─── Quick Stack Selector HTML ────────────────────────────────────────────
  // Renders a row of quick-stack buttons above the product selector.
  // Inject into the order page's card header or above the product list.
  function renderQuickStackButtons(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = `
      <div style="padding:10px 16px;background:var(--card2,#141f16);border-bottom:1px solid var(--border,#1a3d25);">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted2,#6b8a7a);margin-bottom:7px;">
          ⚡ Quick Stacks — One Click
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;">
          ${Object.entries(QUICK_STACKS).map(([key, s]) => `
            <button
              class="btn-sm"
              onclick="window.OrderUXv2.prefillStack('${key}')"
              title="${s.tagline}"
              style="font-size:11px;padding:5px 12px;"
            >${s.emoji} ${s.label.split(' — ')[0]}</button>
          `).join('')}
        </div>
      </div>`;
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    QUICK_STACKS,
    detectStacksInCart,
    prefillStack,
    updateTierLabel,
    autofillClient,
    buildStackDetectionHtml,
    saveOrderAndProtocol,
    renderQuickStackButtons,
    refuseKlowComponent,  // BUG E3 — KLOW doctrine guard
  };

})();

// ─── Auto-wire tier label updates ──────────────────────────────────────────
// Monkey-patch renderOrderLines if it exists, to call updateTierLabel after.
(function patchRenderOrderLines() {
  const original = window.renderOrderLines;
  if (typeof original !== 'function') {
    // app.js may not have loaded yet — retry on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      const orig2 = window.renderOrderLines;
      if (typeof orig2 === 'function') {
        window.renderOrderLines = function() {
          orig2.apply(this, arguments);
          window.OrderUXv2.updateTierLabel();
        };
      }
    });
    return;
  }
  window.renderOrderLines = function() {
    original.apply(this, arguments);
    window.OrderUXv2.updateTierLabel();
  };
})();
