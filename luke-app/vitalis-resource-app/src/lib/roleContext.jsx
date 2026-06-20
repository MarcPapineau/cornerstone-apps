import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * roleContext — the DEMO role-switcher. There is no real auth tonight (auth is last in the
 * build sequence), so the surface a person sees is chosen here instead of derived from a
 * session. Roles mirror the platform's permission model exactly:
 *
 *   ADMIN        → Vitalis platform owner (sees every practice + the full generator)
 *   PRACTITIONER → a tenant; operates the generator, reviews/approves drafts for THEIR clients
 *   CLIENT       → a customer; sees ONLY their practitioner-APPROVED resources (hard rule)
 *
 * The active practitioner / client identity is also held here so the demo can walk every
 * surface. None of this grants data access by itself — the server gates every response.
 */
const LS_KEY = 'vitalis.demoRole';
const DEFAULTS = { role: 'ADMIN', practitionerId: 'pr_lun', clientId: 'demo_kristen_a' };

export const ROLE_LABELS = { ADMIN: 'Vitalis Admin', PRACTITIONER: 'Practitioner', CLIENT: 'Client' };
export const ROLE_HOME = { ADMIN: '/admin', PRACTITIONER: '/practice', CLIENT: '/portal' };
export const ROLE_ORDER = ['ADMIN', 'PRACTITIONER', 'CLIENT'];

const RoleContext = createContext(null);

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function RoleProvider({ children }) {
  const [state, setState] = useState(load);
  // TEST/OPEN-MODE: read at runtime from the server (GET /api/config). Default false so the UI
  // is production by default — the nav only gains the "Generate" group when the server (started
  // with VITALIS_OPEN_MODE=1) reports openMode:true. A failed/absent fetch leaves it false.
  const [openMode, setOpenMode] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  useEffect(() => {
    let alive = true;
    api.config()
      .then((cfg) => { if (alive) setOpenMode(cfg && cfg.openMode === true); })
      .catch(() => { if (alive) setOpenMode(false); });
    return () => { alive = false; };
  }, []);

  const value = {
    ...state,
    openMode,
    setRole: (role) => setState((s) => ({ ...s, role })),
    setPractitionerId: (practitionerId) => setState((s) => ({ ...s, practitionerId })),
    setClientId: (clientId) => setState((s) => ({ ...s, clientId })),
  };
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
