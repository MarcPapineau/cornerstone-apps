import { NavLink } from 'react-router-dom';
import { navForRole } from '../nav.js';
import { useRole, ROLE_LABELS } from '../lib/roleContext.jsx';
import { cn } from '../lib/utils.js';
import vitalisMark from '../assets/vitalis-mark.png';

const SUBTITLE = {
  ADMIN: 'Platform Admin',
  PRACTITIONER: 'Practitioner Workspace',
  CLIENT: 'Client Portal',
};

/**
 * Sidebar — static on desktop (lg+), and rendered as a slide-in drawer on mobile (Layout owns
 * the open/close state + backdrop). `onNavigate` is fired when a nav item is tapped so the
 * drawer can close itself; the same component renders in both modes so the two never drift.
 *
 * Option C hybrid (Marc, 2026-06-04): the PRACTITIONER + ADMIN operational rail is the DARK
 * navy command-center treatment (`--rail-*` tokens); the CLIENT portal rail stays the LIGHT
 * platinum shipped sidebar. The `dark` guard below is the ONLY switch — every rail class is
 * `dark ? <navy> : <existing-light>`, and the light branch is byte-identical to the prior
 * shipped classes so the CLIENT rail is unchanged. The V-mark keeps its white chip in both
 * modes (never cobalt-on-cobalt). The content canvas (Layout/Topbar) is untouched.
 */
export function Sidebar({ drawer = false, onNavigate }) {
  const { role, openMode } = useRole();
  // openMode (GET /api/config, default false) appends the "Generate (Test Mode)" group for the
  // practice roles. With the flag OFF, navForRole returns exactly today's production nav.
  const groups = navForRole(role, { openMode });
  const dark = role === 'ADMIN' || role === 'PRACTITIONER';

  return (
    <aside
      className={cn(
        'h-full shrink-0 flex-col border-r',
        dark ? 'border-rail-border bg-gradient-to-b from-rail-top to-rail' : 'border-border-soft bg-card',
        drawer ? 'flex w-72' : 'hidden w-60 lg:flex',
      )}
    >
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-white shadow-sm">
          <img src={vitalisMark} alt="Vitalis Health Co." className="h-6 w-6 object-contain" />
        </div>
        <div className="leading-tight">
          <div className={cn('font-serif text-lg font-semibold leading-none tracking-tight', dark ? 'text-white' : 'text-primary')}>Vitalis</div>
          <div className={cn('mt-0.5 font-label text-2xs font-semibold uppercase tracking-wide', dark ? 'text-rail-fg-dim' : 'text-faint')}>{SUBTITLE[role] || 'Protocol Generator'}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-3 pb-6">
        {groups.map((group) => (
          <div key={group.label}>
            <div className={cn('px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider', dark ? 'text-rail-fg-dim' : 'text-faint')}>{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? (dark ? 'bg-rail-active-bg text-rail-active-fg' : 'bg-accent-soft text-primary')
                        : (dark ? 'text-rail-fg hover:bg-rail-hover-bg hover:text-white' : 'text-soft hover:bg-muted hover:text-foreground'),
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cn('h-4 w-4 shrink-0', isActive ? (dark ? 'text-white' : 'text-primary') : (dark ? 'text-rail-fg-dim group-hover:text-rail-fg' : 'text-faint group-hover:text-soft'))} />
                      <span className="truncate">{item.label}</span>
                      {item.reserved && (
                        <span className={cn('ml-auto rounded border border-dashed px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide', dark ? 'border-rail-border text-rail-fg-dim' : 'border-border text-faint')}>Reserved</span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('border-t px-4 py-3', dark ? 'border-rail-border' : 'border-border-soft')}>
        <div className={cn('text-2xs leading-relaxed', dark ? 'text-rail-fg-dim' : 'text-faint')}>
          Viewing as <span className={cn('font-medium', dark ? 'text-rail-fg' : 'text-soft')}>{ROLE_LABELS[role] || role}</span>
          <br />
          Shared <span className={cn('font-data', dark ? 'text-rail-fg' : 'text-soft')}>@vitalis/protocol-core</span>
        </div>
      </div>
    </aside>
  );
}
