import { createContext, useContext, useEffect, useState } from 'react';
import netlifyIdentity from 'netlify-identity-widget';

const AuthContext = createContext(null);

// NOTE: No GHL token here. All GHL calls go through /.netlify/functions/ghl-proxy
// so the Private Integration Token never reaches the browser bundle.
const GHL_SYNCED_KEY = 'crh_ghl_synced';

async function sendWelcomeEmail(user) {
  const fullName = user.user_metadata?.full_name || '';
  const firstName = fullName.trim().split(' ')[0] || '';
  try {
    await fetch('/.netlify/functions/welcome-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, firstName }),
    });
  } catch (err) {
    console.error('[CRH] Welcome email failed:', err);
  }
}

async function syncToGHL(user) {
  // Only fire once per user
  const synced = localStorage.getItem(GHL_SYNCED_KEY);
  if (synced) return;

  const fullName = user.user_metadata?.full_name || '';
  const nameParts = fullName.trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  try {
    // Proxy: token stays server-side in ghl-proxy function, never in the bundle.
    await fetch('/.netlify/functions/ghl-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync-contact',
        firstName,
        lastName,
        email: user.email,
        tags: ['cornerstone-re-health-user', 'beta-tester'],
        source: 'Cornerstone RE Health App — Login',
      }),
    });
    localStorage.setItem(GHL_SYNCED_KEY, 'true');
  } catch (err) {
    console.error('[CRH] GHL sync failed:', err);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Use dynamic origin so preview deployments work; falls back to production URL
    const identityUrl = import.meta.env.VITE_AUTH_BASE_URL ||
      (typeof window !== 'undefined' ? `${window.location.origin}/.netlify/identity` : 'https://peptide-resource-app.netlify.app/.netlify/identity');
    netlifyIdentity.init({
      APIUrl: identityUrl,
    });

    // Restore existing session
    const currentUser = netlifyIdentity.currentUser();
    if (currentUser) {
      setUser(currentUser);
    }
    setIsLoading(false);

    // Login event
    netlifyIdentity.on('login', (u) => {
      setUser(u);
      netlifyIdentity.close();
      syncToGHL(u);
    });

    // Signup event — sync to GHL + send welcome email
    netlifyIdentity.on('signup', (u) => {
      setUser(u);
      netlifyIdentity.close();
      syncToGHL(u);
      sendWelcomeEmail(u);
    });

    // Logout event
    netlifyIdentity.on('logout', () => {
      setUser(null);
      localStorage.removeItem(GHL_SYNCED_KEY);
    });

    return () => {
      netlifyIdentity.off('login');
      netlifyIdentity.off('signup');
      netlifyIdentity.off('logout');
    };
  }, []);

  const login = () => netlifyIdentity.open('login');
  const signup = () => netlifyIdentity.open('signup');
  const logout = () => netlifyIdentity.logout();

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
