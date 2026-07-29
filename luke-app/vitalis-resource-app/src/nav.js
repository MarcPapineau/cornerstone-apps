import {
  LayoutDashboard, ClipboardList, TestTubes,
  Boxes, Microscope, ShieldCheck,
  LineChart, Salad,
  Building2, Users, ClipboardCheck, HeartPulse, UserRound, ScrollText,
  Sparkles, Package, Mail, Pill, FilePlus2, Gauge, Activity, CreditCard, Stethoscope, UserCircle2,
  FlaskConical, UtensilsCrossed, Inbox, ShoppingCart,
} from 'lucide-react';

/**
 * Role-scoped left-nav — IA: provider/client silos, NO global client-work dump.
 *   ADMIN        → platform OPERATIONS only (overview, plans, system health, research catalog,
 *                  compliance/research sources). Admin is not a protocol/lab/meal workbench.
 *   PRACTITIONER → CLIENT-FIRST practice (home, clients, invite, review queue, add-ons). All
 *                  client work — generate a package, add a lab, create a meal/supplement add-on,
 *                  view protocols — lives inside each client's DOSSIER at /practice/clients/:id.
 *   CLIENT       → their portal only (APPROVED resources, never drafts or operator fields).
 *
 * The old flat GENERATOR_GROUPS dump (/clients, /labs/results, /package, /draft, /outcomes,
 * /nutrition, /diet, /generate) is deliberately gone from the nav — those tools are reached as
 * per-client ACTIONS inside the dossier, scoped by ?clientId.
 */

const ADMIN_GROUPS = [
  {
    label: 'Platform',
    items: [
      { to: '/admin', label: 'Platform Overview', icon: Building2, end: true },
      { to: '/admin/practitioners', label: 'Practitioners', icon: Stethoscope },
      { to: '/admin/direct-clients', label: 'Direct Clients', icon: UserCircle2 },
      { to: '/admin/plans', label: 'Subscription Plans', icon: CreditCard },
      { to: '/admin/system', label: 'System Health', icon: Activity },
      { to: '/admin/orders', label: 'Order Ops', icon: ShoppingCart },
    ],
  },
  {
    label: 'Research & Compliance',
    items: [
      { to: '/catalog', label: 'Research Catalog', icon: Boxes },
      { to: '/research', label: 'Research Sources', icon: Microscope },
      { to: '/compliance', label: 'Compliance Sources', icon: ShieldCheck },
    ],
  },
];

const PRACTICE_GROUP = {
  label: 'Practice',
  items: [
    { to: '/practice', label: 'Practice Home', icon: LayoutDashboard, end: true },
    { to: '/practice/clients', label: 'My Clients', icon: Users },
    { to: '/practice/invitations', label: 'Invite Clients', icon: Mail },
    { to: '/practice/reviews', label: 'Review Queue', icon: ClipboardCheck },
    { to: '/practice/add-ons', label: 'Add-on Requests', icon: Pill },
  ],
};

// TEST/OPEN-MODE ONLY — a discoverability rail for the team + dev team to reach the generators
// directly. Renders for PRACTITIONER + ADMIN ONLY WHEN the server reports openMode === true
// (GET /api/config, default OFF). With the flag OFF this group is never injected, so production
// nav is byte-identical to today's. It links EXISTING routes only (no new surface): the protocol
// generator (/generate → ProtocolChat), the one-click package (/package → ClientPackage), and the
// silo generators (peptide + bloodwork requisition live inside a client dossier → /practice/clients;
// supplement + meal add-on plans → /practice/add-ons). It removes only navigation FRICTION — every
// server-side gate (approval→visibility, draft-leak, compliance, language) is unchanged.
const GENERATE_GROUP = {
  label: 'Generate (Test Mode)',
  items: [
    { to: '/generate', label: 'Protocol from Text', icon: Sparkles },
    { to: '/package', label: 'One-Click Package', icon: Package },
    { to: '/practice/clients', label: 'Peptide / Bloodwork', icon: ScrollText },
    { to: '/practice/add-ons', label: 'Supplement / Meal', icon: Pill },
  ],
};

// Client portal — clear product/service SILOS (every target maps to a real route; no 404s).
// Removed vague labels: My Resources→Dashboard · My Care Package→Lab Requests · My Add-ons→split
// into Supplement/Meal/Requests · Nutrition Slip→Nutrition Plans · Explore Research dropped.
// Intake + Profile remain reachable as routes (surfaced from the Dashboard / Account), not nav noise.
const PORTAL_GROUP = {
  label: 'My Health',
  items: [
    { to: '/portal', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/portal/protocols', label: 'Peptide Protocols', icon: ScrollText },
    { to: '/portal/nutrition', label: 'Nutrition Plans', icon: Salad },
    { to: '/portal/add-ons?silo=supplement', label: 'Supplement Plans', icon: Pill },
    { to: '/portal/add-ons?silo=meal', label: 'Meal Plans', icon: UtensilsCrossed },
    { to: '/portal/package', label: 'Lab Requests', icon: FlaskConical },
    { to: '/portal/labs', label: 'Bloodwork & Results', icon: TestTubes },
    { to: '/portal/progress', label: 'Progress & Goals', icon: LineChart },
    { to: '/portal/documents', label: 'Documents', icon: FilePlus2 },
    { to: '/portal/add-ons', label: 'Requests & Status', icon: Inbox },
    { to: '/portal/usage', label: 'Account / Plan', icon: Gauge },
  ],
};

export const NAV_BY_ROLE = {
  ADMIN: ADMIN_GROUPS,
  PRACTITIONER: [PRACTICE_GROUP],
  CLIENT: [PORTAL_GROUP],
};

/**
 * navForRole(role, { openMode }) — the role's nav groups.
 *
 * `openMode` is the runtime TEST/OPEN-MODE flag (read from GET /api/config; default false). When
 * it is true AND the role is a practice role (PRACTITIONER or ADMIN), the discoverability
 * "Generate (Test Mode)" group is APPENDED so testers can reach the generators directly. The
 * CLIENT portal is NEVER given the Generate group (the client surface is approved-resources-only).
 * When openMode is false the returned groups are exactly today's production nav — additive only.
 */
export function navForRole(role, { openMode = false } = {}) {
  const base = NAV_BY_ROLE[role] || NAV_BY_ROLE.ADMIN;
  if (openMode && (role === 'PRACTITIONER' || role === 'ADMIN')) {
    return [...base, GENERATE_GROUP];
  }
  return base;
}
