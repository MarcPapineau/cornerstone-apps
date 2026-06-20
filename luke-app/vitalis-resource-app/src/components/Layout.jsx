import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { Disclaimer } from './Disclaimer.jsx';

/**
 * Layout — the app shell. Desktop keeps the static sidebar; on mobile/tablet (< lg) the
 * sidebar collapses behind a hamburger (Topbar) that opens a slide-in drawer with a backdrop.
 * The drawer closes on any route change, on backdrop tap, and on nav-item tap — so there is
 * never content overlap on a phone.
 */
export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 h-full shadow-xl">
            <Sidebar drawer onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-7">
            <Outlet />
          </div>
        </main>
        <Disclaimer />
      </div>
    </div>
  );
}
