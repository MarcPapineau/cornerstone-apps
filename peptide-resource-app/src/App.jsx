import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Nav from './components/Nav';
import Home from './pages/Home';
import Login from './pages/Login';
import CompoundLibrary from './pages/CompoundLibrary';
import StackFinder from './pages/StackFinder';
import StackBuilder from './pages/StackBuilder';
import DosingGuide from './pages/DosingGuide';
import SideEffects from './pages/SideEffects';
import Contact from './pages/Contact';
import Highlights from './pages/Highlights';
import FAQ from './pages/FAQ';
import Start from './pages/Start';
import VitalisChat from './components/VitalisChat';
import { AuthProvider, useAuth } from './context/AuthContext';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AuthLoading() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a1628',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
      }}>
        <span style={{ fontSize: '2.5rem', filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.4))' }}>🏥</span>
        <div style={{
          width: '36px',
          height: '36px',
          border: '3px solid rgba(212,175,55,0.2)',
          borderTop: '3px solid #d4af37',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>Loading your research platform…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <AuthLoading />;

  return (
    <div style={{ minHeight: '100vh', background: '#0a1628' }}>
      {user && <Nav />}
      <Routes>
        {/* Public */}
        <Route path="/login" element={
          user ? <Navigate to="/start" replace /> : <Login />
        } />

        {/* Protected */}
        <Route path="/" element={
          <RequireAuth><Start /></RequireAuth>
        } />
        <Route path="/start" element={
          <RequireAuth><Start /></RequireAuth>
        } />
        <Route path="/compounds" element={
          <RequireAuth><CompoundLibrary /></RequireAuth>
        } />
        <Route path="/stacks" element={
          <RequireAuth><StackFinder /></RequireAuth>
        } />
        <Route path="/stack-builder" element={
          <RequireAuth><StackBuilder /></RequireAuth>
        } />
        <Route path="/dosing" element={
          <RequireAuth><DosingGuide /></RequireAuth>
        } />
        <Route path="/safety" element={
          <RequireAuth><SideEffects /></RequireAuth>
        } />
        <Route path="/contact" element={
          <RequireAuth><Contact /></RequireAuth>
        } />
        <Route path="/highlights" element={
          <RequireAuth><Highlights /></RequireAuth>
        } />
        <Route path="/faq" element={
          <RequireAuth><FAQ /></RequireAuth>
        } />

        {/* Catch-all */}
        <Route path="*" element={
          user ? (
            <div style={{ textAlign: 'center', padding: '80px 20px', color: '#64748b' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔬</div>
              <h2 style={{ color: '#fff', marginBottom: '12px' }}>Page Not Found</h2>
              <a href="/" style={{ color: '#d4af37', textDecoration: 'none', fontWeight: 600 }}>← Back to Home</a>
            </div>
          ) : (
            <Navigate to="/login" replace />
          )
        } />
      </Routes>

      {/* Vitalis Chat — persistent bottom-right widget on all authed routes.
          Also renders when ?vitalis-preview=1 is in the URL for demo/QA without auth. */}
      {(user || (typeof window !== 'undefined' && window.location.search.includes('vitalis-preview=1'))) && <VitalisChat />}

      {user && (
        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '1.2rem' }}>🏥</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>Vitalis <span style={{ color: '#d4af37' }}>Health</span></span>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
              Educational resource for Marc Papineau's research clients. Not medical advice.
            </p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#475569' }}>
              © {new Date().getFullYear()} Cornerstone RE Health — Research Education Platform
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
