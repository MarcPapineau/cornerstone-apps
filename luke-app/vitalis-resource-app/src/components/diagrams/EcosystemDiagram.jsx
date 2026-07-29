import {
  LayoutDashboard, Users, CircleUserRound, FileText, FlaskRound, ClipboardCheck,
  Activity, BarChart3, Pill, UtensilsCrossed, ScrollText, Plug, ShieldCheck,
} from 'lucide-react';

/**
 * EcosystemDiagram — the "Vitalis Ecosystem" presentation infographic (hand-authored radial SVG,
 * promoted from the Phase-0 proof). Hub = the server-authoritative APPROVAL GATE + evidence-tier
 * doctrine (the moat). Spokes = the real platform building blocks.
 *
 * HONESTY MANDATE (locked):
 *   - Node status is hard-coded category framing, NOT a live query: LIVE silos render solid +
 *     cobalt; EARLY-ACCESS and ROADMAP nodes are de-weighted (steel, dashed connectors) and
 *     carry an explicit status label.
 *   - FORBIDDEN and absent by construction: any named/signed partner or logo (category framing
 *     only — the demo roster names never appear as signed nodes), an active-revenue band, and any
 *     live-feed node. Billing / entitlements + the referral network are ROADMAP (not wired).
 *   - Colors read from the app --chart-* / token family so the diagram follows any re-skin.
 *
 * Props: `nodes` (override the default node set) — each { label, icon, status: 'live'|'early'|'roadmap' }.
 */
const DEFAULT_NODES = [
  { label: 'Admin Portal', icon: LayoutDashboard, status: 'live' },
  { label: 'Practitioner Portal', icon: Users, status: 'live' },
  { label: 'Client Portal', icon: CircleUserRound, status: 'live' },
  { label: 'Peptide Protocol', icon: FileText, status: 'live' },
  { label: 'Bloodwork Requisition', icon: FlaskRound, status: 'live' },
  { label: 'Intake & Onboarding', icon: ClipboardCheck, status: 'live' },
  { label: 'Labs / Biomarkers', icon: Activity, status: 'live' },
  { label: 'Progress & Outcomes', icon: BarChart3, status: 'live' },
  { label: '121-SKU Catalog', icon: Pill, status: 'live' },
  { label: 'Supplement / Meal Plans', icon: UtensilsCrossed, status: 'early' },
  { label: 'Entitlements / Billing', icon: ScrollText, status: 'roadmap' },
  { label: 'Referral Network', icon: Plug, status: 'roadmap' },
];

// Token-driven status palette (cobalt for live, cool-steel for de-weighted roadmap/early).
const COBALT = 'hsl(var(--chart-1))';
const STEEL = 'hsl(var(--chart-2))';
const STEEL_DEEP = 'hsl(218 14% 46%)';
const INK = 'hsl(var(--foreground))';
const FAINT = 'hsl(var(--faint))';
const WARN = 'hsl(var(--warning))';

const STATUS = {
  live: { ring: COBALT, icon: COBALT, label: 'Live', labelColor: 'hsl(var(--success))' },
  early: { ring: 'hsl(217 48% 58%)', icon: 'hsl(217 48% 52%)', label: 'Early access', labelColor: WARN },
  roadmap: { ring: STEEL, icon: STEEL_DEEP, label: 'Roadmap', labelColor: FAINT },
};

export function EcosystemDiagram({ nodes = DEFAULT_NODES }) {
  const W = 920, H = 540;
  const cx = W / 2, cy = H / 2;
  const rx = 360, ry = 210; // elliptical orbit so labels breathe horizontally
  const n = nodes.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Vitalis ecosystem: a central server-authoritative approval gate and evidence-tier doctrine, surrounded by the real platform building blocks. Early-access and roadmap nodes are de-weighted and labelled; no named partners, no live revenue."
    >
      {/* connectors first (behind nodes) */}
      {nodes.map((node, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        const x = cx + rx * Math.cos(a);
        const y = cy + ry * Math.sin(a);
        const live = node.status === 'live';
        return (
          <line
            key={`l-${i}`}
            x1={cx} y1={cy} x2={x} y2={y}
            stroke={live ? COBALT : STEEL}
            strokeWidth={live ? 1.4 : 1.1}
            strokeOpacity={live ? 0.35 : 0.5}
            strokeDasharray={live ? undefined : '4 5'}
          />
        );
      })}

      {/* HUB — the approval gate + evidence doctrine (the moat) */}
      <circle cx={cx} cy={cy} r={92} fill="hsl(var(--card))" stroke={COBALT} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={92} fill="none" stroke={COBALT} strokeOpacity={0.12} strokeWidth={14} />
      <foreignObject x={cx - 80} y={cy - 60} width={160} height={120}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
          <span style={{ display: 'flex', height: 34, width: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: COBALT, marginBottom: 6 }}>
            <ShieldCheck style={{ width: 20, height: 20, color: '#fff' }} />
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.15 }}>Approval Gate</div>
          <div style={{ fontSize: 9.5, color: FAINT, marginTop: 2, lineHeight: 1.2 }}>+ evidence-tier doctrine<br />(the moat)</div>
        </div>
      </foreignObject>

      {/* NODES */}
      {nodes.map((node, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        const x = cx + rx * Math.cos(a);
        const y = cy + ry * Math.sin(a);
        const s = STATUS[node.status] || STATUS.roadmap;
        const Icon = node.icon;
        const onRight = x >= cx;
        return (
          <g key={`n-${i}`}>
            <circle cx={x} cy={y} r={26} fill="hsl(var(--card))" stroke={s.ring} strokeWidth={1.75} />
            <foreignObject x={x - 13} y={y - 13} width={26} height={26}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Icon style={{ width: 15, height: 15, color: s.icon }} />
              </div>
            </foreignObject>
            <foreignObject x={onRight ? x + 30 : x - 30 - 150} y={y - 18} width={150} height={38}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: onRight ? 'flex-start' : 'flex-end', justifyContent: 'center', height: '100%' }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: INK, lineHeight: 1.1, textAlign: onRight ? 'left' : 'right' }}>{node.label}</span>
                {node.status !== 'live' && (
                  <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: s.labelColor, marginTop: 1 }}>{s.label}</span>
                )}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

export default EcosystemDiagram;
