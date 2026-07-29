import './vdoc.css';
import { cn } from '../../lib/utils.js';

/**
 * VitalisDocumentShell + primitives — the reusable "Vitalis Research" document renderer.
 *
 * Every silo document (Peptide / Nutrition / Supplement / Blood Requisition) composes these
 * presentational primitives, so all four read as one branded system that matches the canonical
 * PDF. Primitives render ONLY what they are given — no data fetching, no clinical content of
 * their own. Styling lives in vdoc.css (scoped under `.vdoc`, insulated from app Tailwind tokens).
 *
 * Educational / research document — never a prescription.
 */

export function Wordmark({ small = false }) {
  return <span className={cn('vd-wordmark', small && 'vd-wordmark--sm')}>Vitalis&nbsp;<em>Research</em></span>;
}

export function VitalisDocumentShell({ children, className }) {
  return (
    <div className={cn('vdoc vdoc--sheet', className)}>
      <div className="vdoc__pad">{children}</div>
    </div>
  );
}

export function DocStatusBanner({ status, draftLabel, approvedLabel }) {
  const approved = status === 'APPROVED_RESOURCE';
  return (
    <div className={cn('vd-banner', approved ? 'vd-banner--approved' : 'vd-banner--draft')}>
      {approved
        ? (approvedLabel || 'Approved resource · reviewed by your practitioner · educational, not a prescription')
        : (draftLabel || 'Draft · practitioner-only · not yet client-visible')}
    </div>
  );
}

/** Cover — wordmark band, protocol-class eyebrow, serif title, thesis, metadata, review band. */
export function DocCover({ kicker = 'Research Documents · Educational Use Only', eyebrow, title, thesis, meta = [], review }) {
  return (
    <header>
      <Wordmark />
      <div className="vd-kicker" style={{ marginTop: 6 }}>{kicker}</div>
      {eyebrow && <div className="vd-eyebrow" style={{ marginTop: 34 }}>{eyebrow}</div>}
      {title && <h1 className="vd-title">{title}</h1>}
      {thesis && <p className="vd-thesis">{thesis}</p>}
      {meta.length > 0 && (
        <dl className="vd-meta">
          {meta.map((m, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt className="vd-meta__label">{m.label}</dt>
              <dd className="vd-meta__value">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {review && (
        <div className="vd-callout" style={{ marginTop: 32 }}>
          {review.title && <span className="vd-callout__title">{review.title} </span>}
          <span className="vd-em">{review.body}</span>
        </div>
      )}
    </header>
  );
}

/** A numbered section with the running header (wordmark | SECTION 0N · TITLE) + gold rule. */
export function DocSection({ n, runhead, eyebrow, title, intro, children }) {
  return (
    <section className="vd-section">
      <div className="vd-runhead">
        <Wordmark small />
        {runhead && <span className="vd-runhead__ref">{runhead}</span>}
      </div>
      <hr className="vd-rule" />
      {(eyebrow || n != null) && <div className="vd-eyebrow" style={{ marginTop: 22 }}>{eyebrow || `Section ${n}`}</div>}
      {title && <h2 className="vd-section-title">{title}</h2>}
      {intro && <p className="vd-thesis">{intro}</p>}
      {children}
    </section>
  );
}

export function DocStatBand({ stats = [] }) {
  if (!stats.length) return null;
  return (
    <div className="vd-statband">
      {stats.map((s, i) => (
        <div className="vd-stat" key={i}>
          <div className="vd-stat__value">{s.value}</div>
          <div className={cn('vd-stat__accent', s.tone === 'coral' && 'vd-stat__accent--coral', s.tone === 'slate' && 'vd-stat__accent--slate')} />
          <div className="vd-stat__label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function DocCardGrid({ children }) {
  return <div className="vd-cardgrid">{children}</div>;
}

export function DocCompoundCard({ name, descriptor, role, roleTone = 'support', children }) {
  return (
    <div className={cn('vd-card', `vd-card--${roleTone}`)}>
      <div className="vd-card__name">{name}{descriptor && <span className="vd-card__desc">  {descriptor}</span>}</div>
      {role && <div className={cn('vd-card__role', roleTone === 'anchor' && 'vd-card__role--anchor', roleTone === 'foundation' && 'vd-card__role--foundation')}>{role}</div>}
      <div className="vd-card__body">{children}</div>
    </div>
  );
}

/**
 * Clinical table. head = [{label, sub?}]; rows = array of cell-arrays where a cell is a
 * string/node, or {block, sub} (gold serif first column), or {muted} (italic "— done —").
 */
export function DocClinicalTable({ head = [], rows = [] }) {
  return (
    <div className="vd-table-wrap">
      <table className="vd-table">
        <thead>
          <tr>{head.map((h, i) => <th key={i}>{h.label}{h.sub && <span className="vd-th-sub">{h.sub}</span>}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((c, i) => {
                if (c && typeof c === 'object' && c.block != null) {
                  return <td key={i}><span className="vd-table__block">{c.block}</span>{c.sub && <span className="vd-table__block-sub">{c.sub}</span>}</td>;
                }
                if (c && typeof c === 'object' && c.muted != null) {
                  return <td key={i} className="vd-table__muted">{c.muted}</td>;
                }
                return <td key={i}>{c}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Reference panel (gold left border) with a definition list. */
export function DocPanel({ name, descriptor, cadence, children }) {
  return (
    <div className="vd-panel">
      <div className="vd-panel__head">
        <div className="vd-panel__name">{name}{descriptor && <em>  {descriptor}</em>}</div>
        {cadence && <div className="vd-panel__cadence">{cadence}</div>}
      </div>
      <dl className="vd-deflist">{children}</dl>
    </div>
  );
}

export function DocDef({ label, children }) {
  return (
    <div className="vd-def">
      <dt className="vd-def__dt">{label}</dt>
      <dd className="vd-def__dd">{children}</dd>
    </div>
  );
}

const TIER_CLASS = { T1: 'vd-badge--t1', T2: 'vd-badge--t2', T3: 'vd-badge--t3', T4: 'vd-badge--t4' };
export function EvidenceBadge({ tier }) {
  const t = String(tier || '').toUpperCase();
  return <span className={cn('vd-badge', TIER_CLASS[t])}>{t || '—'}</span>;
}

export function DocCallout({ tone, title, children }) {
  return (
    <div className={cn('vd-callout', tone === 'coral' && 'vd-callout--coral', tone === 'slate' && 'vd-callout--slate', tone === 'plain' && 'vd-callout--plain')}>
      {title && <span className="vd-callout__title">{title} </span>}
      {children}
    </div>
  );
}

export function DocNumberedList({ items = [] }) {
  return (
    <ol className="vd-ol">
      {items.map((it, i) => (
        <li key={i}>{it.lead && <span className="vd-strong">{it.lead} </span>}{it.body || it}</li>
      ))}
    </ol>
  );
}

export function DocSignalGrid({ children }) {
  return <div className="vd-signalgrid">{children}</div>;
}

export function DocSignal({ tier = 'observe', eyebrow, title, children }) {
  return (
    <div className={cn('vd-signal', `vd-signal--${tier}`)}>
      {eyebrow && <div className="vd-signal__tier">{eyebrow}</div>}
      {title && <div className="vd-signal__title">{title}</div>}
      <div className="vd-signal__body">{children}</div>
    </div>
  );
}

export function DocDisclaimer({ title, children }) {
  return (
    <div className="vd-disclaimer">
      {title && <span className="vd-disclaimer__title">{title} </span>}
      {children}
    </div>
  );
}

export default VitalisDocumentShell;
