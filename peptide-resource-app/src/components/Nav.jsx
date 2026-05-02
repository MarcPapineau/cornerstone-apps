import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ── 5-step primary waterfall nav ────────────────────────────
// FIX BUG-010: labels match page headers. Step 3 = Personalize (chat widget, no link)
//
// 2026-05-01 (BUG E5 — Protocol link goes to broken route):
//   Previously the Protocol step pointed to '/protocol/' with `partial: true`.
//   App.jsx route is `path="/protocol/:goal"` — React Router does NOT match
//   '/protocol/' (trailing slash, missing :goal segment). Click → 404 fallback.
//   Fix per dispatch: route Protocol step to '/goals' (which renders the same
//   Landing page as '/' — see App.jsx:91-96). Goals page is the legitimate
//   "pick a protocol" entry point; once user picks a goal, Landing navigates
//   to '/protocol/<goal>' which DOES match the route. Match `partial: true`
//   so deep routes like '/protocol/recovery' still highlight the Protocol step.
//
//   Step 3 (Personalize) is rendered inline as a non-link placeholder so the
//   1→2→3→4→5 sequence reads cleanly and Marc's mental model stays intact.
//   placeholder=true marks it as non-clickable; the renderer below skips
//   the <Link> and renders a greyed <span> for placeholders.
//
//   Wisdom: a broken nav link is worse than a missing one — users blame
//           themselves first. Knowledge: React Router 6 requires literal
//           param-segment match, not trailing-slash partial. Understanding:
//           '/goals' aliases Landing in App.jsx, so this is a zero-new-component
//           fix; once a goal is selected, the existing flow continues unchanged.
const WATERFALL_STEPS = [
  { to: '/',          label: '1 Goals',       step: 1 },
  { to: '/goals',     label: '2 Protocol',    step: 2, partial: true,
    activePathPrefix: '/protocol/' /* highlight when on /protocol/<goal> */ },
  { to: null,         label: '3 Personalize', step: 3, placeholder: true,
    title: 'Opens automatically on the Protocol page' },
  { to: '/build',     label: '4 Build',       step: 4 },
  { to: '/book',      label: '5 Book',        step: 5 },
];

// ── Library sub-nav (old content, still reachable) ───────────
const LIBRARY_LINKS = [
  { to: '/compounds',    label: 'Compounds' },
  { to: '/stacks',       label: 'Stacks' },
  { to: '/stack-builder',label: 'Stack Builder' },
  { to: '/dosing',       label: 'Dosing Guide' },
  { to: '/safety',       label: 'Safety' },
  { to: '/highlights',   label: 'Highlights' },
  { to: '/faq',          label: 'FAQ' },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const userEmail = user?.email || '';
  const displayEmail = userEmail.length > 22 ? userEmail.slice(0, 20) + '…' : userEmail;

  const isActiveWaterfall = (link) => {
    if (link.placeholder) return false;
    // E5: when activePathPrefix is set (e.g. Protocol step routes to /goals
    // but should highlight when user is on /protocol/<goal>), treat the prefix
    // as the active-state matcher.
    if (link.activePathPrefix && location.pathname.startsWith(link.activePathPrefix)) return true;
    if (link.partial) return location.pathname.startsWith(link.to);
    return location.pathname === link.to;
  };

  const isLibraryActive = LIBRARY_LINKS.some(l => location.pathname === l.to);

  return (
    <nav style={{
      background: 'rgba(10, 22, 40, 0.97)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>

          {/* Logo */}
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.5rem' }}>🏥</span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>
              Vitalis <span style={{ color: '#d4af37' }}>Health</span>
            </span>
          </Link>

          {/* Desktop: waterfall steps + library dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'nowrap' }} className="desktop-nav">

            {WATERFALL_STEPS.map(link => {
              // E5: placeholder steps (e.g. step 3 Personalize) render as a
              // non-clickable greyed <span> so the 1→2→3→4→5 sequence visually
              // reads clean even when the step isn't independently routable.
              if (link.placeholder) {
                return (
                  <span
                    key={link.label}
                    title={link.title || ''}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      color: '#475569',          // greyed
                      background: 'transparent',
                      border: '1px solid transparent',
                      cursor: 'default',
                      opacity: 0.7,
                    }}
                  >
                    {link.label}
                  </span>
                );
              }
              const active = isActiveWaterfall(link);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: active ? 700 : 600,
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    color: active ? '#d4af37' : '#94a3b8',
                    background: active ? 'rgba(212,175,55,0.1)' : 'transparent',
                    border: active ? '1px solid rgba(212,175,55,0.2)' : '1px solid transparent',
                  }}
                >
                  {link.label}
                </Link>
              );
            })}

            {/* Library dropdown */}
            <div
              style={{ position: 'relative' }}
              onMouseEnter={() => setLibOpen(true)}
              onMouseLeave={() => setLibOpen(false)}
            >
              <button
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  color: isLibraryActive ? '#d4af37' : '#94a3b8',
                  background: isLibraryActive ? 'rgba(212,175,55,0.1)' : 'transparent',
                  border: '1px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                Library <span style={{ fontSize: '0.65rem' }}>▾</span>
              </button>

              {libOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: '#0d1f38',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '6px',
                  minWidth: '160px',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                  zIndex: 100,
                }}>
                  {LIBRARY_LINKS.map(link => (
                    <Link
                      key={link.to}
                      to={link.to}
                      style={{
                        display: 'block',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        textDecoration: 'none',
                        color: location.pathname === link.to ? '#d4af37' : '#94a3b8',
                        background: location.pathname === link.to ? 'rgba(212,175,55,0.08)' : 'transparent',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.target.style.background = 'rgba(212,175,55,0.06)'; e.target.style.color = '#f1f5f9'; }}
                      onMouseLeave={e => {
                        e.target.style.background = location.pathname === link.to ? 'rgba(212,175,55,0.08)' : 'transparent';
                        e.target.style.color = location.pathname === link.to ? '#d4af37' : '#94a3b8';
                      }}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Book CTA */}
            <Link
              to="/book"
              style={{
                padding: '7px 16px',
                fontSize: '0.82rem',
                textDecoration: 'none',
                marginLeft: '8px',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
                background: '#d4af37',
                color: '#0a1628',
                fontWeight: 700,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => e.target.style.background = '#e8c84a'}
              onMouseLeave={e => e.target.style.background = '#d4af37'}
            >
              Book Consult
            </Link>

            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px', paddingLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: '0.7rem', color: '#475569', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayEmail}
                </span>
                <button
                  onClick={logout}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    padding: '5px 10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = 'rgba(212,175,55,0.4)'; e.target.style.color = '#d4af37'; }}
                  onMouseLeave={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.color = '#94a3b8'; }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="mobile-menu-btn"
            onClick={() => setOpen(!open)}
            style={{
              background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
              padding: '8px', display: 'none',
            }}
            aria-label="Toggle menu"
          >
            <div style={{ width: '22px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ display: 'block', height: '2px', background: open ? '#d4af37' : '#fff', borderRadius: '2px', transition: 'all 0.2s', transform: open ? 'rotate(45deg) translateY(7px)' : 'none' }}></span>
              <span style={{ display: 'block', height: '2px', background: '#fff', borderRadius: '2px', opacity: open ? 0 : 1, transition: 'all 0.2s' }}></span>
              <span style={{ display: 'block', height: '2px', background: open ? '#d4af37' : '#fff', borderRadius: '2px', transition: 'all 0.2s', transform: open ? 'rotate(-45deg) translateY(-7px)' : 'none' }}></span>
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div style={{ paddingBottom: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ padding: '8px 0 4px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#475569' }}>
              Your Journey
            </div>
            {WATERFALL_STEPS.map(link => {
              // E5: placeholder rows render as a greyed non-clickable <div>.
              if (link.placeholder) {
                return (
                  <div
                    key={link.label}
                    title={link.title || ''}
                    style={{
                      display: 'block', padding: '12px 4px', fontSize: '0.95rem', fontWeight: 500,
                      color: '#475569',
                      opacity: 0.7,
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'default',
                    }}
                  >
                    {link.label}
                  </div>
                );
              }
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'block', padding: '12px 4px', fontSize: '0.95rem', fontWeight: 600,
                    textDecoration: 'none',
                    color: isActiveWaterfall(link) ? '#d4af37' : '#94a3b8',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  {link.label}
                </Link>
              );
            })}

            <div style={{ padding: '12px 0 4px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#475569' }}>
              Library
            </div>
            {LIBRARY_LINKS.map(link => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                style={{
                  display: 'block', padding: '10px 4px', fontSize: '0.88rem', fontWeight: 500,
                  textDecoration: 'none',
                  color: location.pathname === link.to ? '#d4af37' : '#64748b',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}
              >
                {link.label}
              </Link>
            ))}

            <Link
              to="/book"
              onClick={() => setOpen(false)}
              style={{
                display: 'block', textAlign: 'center', marginTop: '12px', textDecoration: 'none',
                padding: '12px', borderRadius: '8px',
                background: '#d4af37', color: '#0a1628', fontWeight: 700,
              }}
            >
              Book Consult
            </Link>

            {user && (
              <div style={{ marginTop: '12px', padding: '12px 4px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>{displayEmail}</span>
                <button
                  onClick={() => { setOpen(false); logout(); }}
                  style={{
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '6px', color: '#94a3b8', fontSize: '0.78rem', padding: '6px 12px', cursor: 'pointer',
                  }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
        @media (min-width: 1025px) {
          .mobile-menu-btn { display: none !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </nav>
  );
}
