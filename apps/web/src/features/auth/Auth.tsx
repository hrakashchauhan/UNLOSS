import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, registerSellerSessionExpired, type Seller } from '../../api';
import { ErrorBox, errText } from '../../ui/common';
import { DEMO_ENABLED } from '../../config';

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  deliveryStatus?: string;
}

export type UserRole = 'SELLER' | 'DELIVERY' | 'CUSTOMER' | 'ADMIN';

type AuthPhase = 'checking' | 'authenticated' | 'unauthenticated' | 'error';
export interface AuthContextValue {
  seller: Seller | null;
  user: AuthUser | null;
  mode: 'demo' | 'manual';
  phase: AuthPhase;
  restore: (signal?: AbortSignal) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Seller authentication provider is missing.');
  return context;
}

export function AuthProvider() {
  const [seller, setSeller] = useState<Seller | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<'demo' | 'manual'>('manual');
  const [phase, setPhase] = useState<AuthPhase>('checking');

  const restore = useCallback(async (signal?: AbortSignal) => {
    setPhase('checking');
    try {
      const response = await api<{ seller?: Seller | null; user?: AuthUser | null; mode?: 'demo' | 'manual' }>('/auth/me', { signal });
      if (!response.seller?.id && !response.user?.id) {
        throw new ApiError(200, 'INVALID_RESPONSE', 'The server returned an invalid session.');
      }
      if (!signal?.aborted) {
        setSeller(response.seller || null);
        setUser(response.user || null);
        setMode(response.mode === 'demo' ? 'demo' : 'manual');
        setPhase('authenticated');
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setSeller(null);
      setUser(null);
      setPhase(error instanceof ApiError && error.status === 401 ? 'unauthenticated' : 'error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    registerSellerSessionExpired(() => { setSeller(null); setUser(null); setPhase('unauthenticated'); });
    void restore(controller.signal);
    return () => { controller.abort(); registerSellerSessionExpired(); };
  }, [restore]);

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await api<{ seller?: Seller | null; user?: AuthUser | null; mode?: 'demo' | 'manual' }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!response.seller?.id && !response.user?.id) {
      throw new ApiError(200, 'INVALID_RESPONSE', 'The server returned an invalid session.');
    }
    setSeller(response.seller || null);
    setUser(response.user || null);
    setMode(response.mode === 'demo' ? 'demo' : 'manual');
    setPhase('authenticated');
  }, []);

  const switchRole = useCallback(async (role: UserRole) => {
    const response = await api<{ seller?: Seller | null; user?: AuthUser | null; mode?: 'demo' | 'manual' }>('/auth/demo-switch', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    setSeller(response.seller || null);
    setUser(response.user || null);
    setMode(response.mode === 'demo' ? 'demo' : 'manual');
    setPhase('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try { await api<void>('/auth/logout', { method: 'POST' }); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    setSeller(null);
    setUser(null);
    setPhase('unauthenticated');
  }, []);

  const value = useMemo(() => ({ seller, user, mode, phase, restore, signIn, switchRole, signOut }), [seller, user, mode, phase, restore, signIn, switchRole, signOut]);
  return <AuthContext.Provider value={value}><Outlet /></AuthContext.Provider>;
}

function SessionStatus() {
  const { restore } = useAuth();
  const [retrying, setRetrying] = useState(false);
  async function retry() { setRetrying(true); try { await restore(); } finally { setRetrying(false); } }
  return <main className="recovery-screen"><h1>Unable to check your session</h1><p>The API is unavailable. Your sign-in status is unknown.</p><button className="button primary" disabled={retrying} onClick={retry}>{retrying ? 'Checking…' : 'Try again'}</button></main>;
}

export function RequireRole({ allowedRoles }: { allowedRoles: UserRole[] }) {
  const { seller, user, phase } = useAuth();
  const location = useLocation();
  if (phase === 'checking') return <main className="splash" role="status">Preparing your workspace…</main>;
  if (phase === 'error') return <SessionStatus />;
  if (phase !== 'authenticated' || (!seller && !user)) {
    return <Navigate replace to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)} />;
  }

  const effectiveRoles: UserRole[] = [];
  if (seller) effectiveRoles.push('SELLER');
  if (user?.roles) {
    user.roles.forEach(r => {
      if (['SELLER', 'DELIVERY', 'CUSTOMER', 'ADMIN'].includes(r) && !effectiveRoles.includes(r as UserRole)) {
        effectiveRoles.push(r as UserRole);
      }
    });
  }

  const hasPermission = allowedRoles.some(r => effectiveRoles.includes(r));
  if (!hasPermission) {
    return (
      <main className="recovery-screen">
        <div className="eyebrow" style={{ color: 'var(--primary)', fontWeight: 700 }}>ROLE RESTRICTED</div>
        <h1>Access Restricted</h1>
        <p>This workspace is restricted to <b>{allowedRoles.join(', ')}</b> accounts. Your active session currently has role(s): <b>{effectiveRoles.join(', ') || 'NONE'}</b>.</p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
          {effectiveRoles.includes('SELLER') && <Link className="button primary" to="/dashboard">Go to Seller Workspace</Link>}
          {effectiveRoles.includes('DELIVERY') && <Link className="button primary" to="/delivery-portal">Go to Delivery Portal</Link>}
          {effectiveRoles.includes('CUSTOMER') && <Link className="button primary" to="/customer-portal">Go to Customer Portal</Link>}
          {effectiveRoles.includes('ADMIN') && <Link className="button primary" to="/admin">Go to Administrator Console</Link>}
          <Link className="button" to="/login">Sign in with different account</Link>
        </div>
      </main>
    );
  }
  return <Outlet />;
}

export function RequireSeller() {
  return <RequireRole allowedRoles={['SELLER']} />;
}

function safeReturnTo(requested: string | null) {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//') || requested.includes('\\') || [...requested].some(character => character.charCodeAt(0) < 32) || /^\/(login|customer\/[a-zA-Z0-9_-]+|delivery\/[a-zA-Z0-9_-]+)(\/|\?|$)/.test(requested)) return '/dashboard';
  return requested;
}

export function LoginRoute() {
  const { phase } = useAuth();
  const [searchParams] = useSearchParams();
  const target = safeReturnTo(searchParams.get('returnTo'));
  if (phase === 'checking') return <main className="splash" role="status">Checking your session…</main>;
  if (phase === 'error') return <SessionStatus />;
  if (phase === 'authenticated') return <Navigate replace to={target} />;
  return <LoginForm returnTo={target} />;
}

function LoginForm({ returnTo }: { returnTo: string }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const formEmail = String(form.get('email') || email).trim();
    const formPassword = String(form.get('password') || password);
    setPending(true); setError('');
    try {
      await signIn(formEmail, formPassword);
      navigate(returnTo, { replace: true });
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }

  function fillDemo(demoEmail: string, targetPath: string) {
    setEmail(demoEmail);
    setPassword('0wEU9db2P063yo_R0GsEr4NP');
    // Also if targetPath is given, update returnTo if needed
    if (returnTo === '/dashboard' && targetPath !== '/dashboard') {
      navigate(`/login?returnTo=${encodeURIComponent(targetPath)}`, { replace: true });
    }
  }

  return (
    <main className="login-screen">
      <div className="login-card">
        <div className="brand login-brand">
          <div className="brand-mark">u</div>
          <span>unloss<span className="brand-dot">.</span></span>
        </div>
        <div className="eyebrow" style={{ color: 'var(--primary)', fontWeight: 700 }}>PARCEL VERIFICATION PLATFORM</div>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to your role-based delivery accountability workspace.</p>

        {DEMO_ENABLED && (
          <div style={{ background: 'var(--primary-light)', padding: '12px 14px', borderRadius: '6px', marginBottom: '16px', border: '1px solid var(--primary-border)' }}>
            <small style={{ display: 'block', fontWeight: 700, color: 'var(--primary)', marginBottom: '8px' }}>QUICK DEMO ROLES (CLICK TO FILL):</small>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" className="button" style={{ fontSize: '.8rem', minHeight: '32px', padding: '4px 10px' }} onClick={() => fillDemo('demo@unloss.local', '/dashboard')}>
                Seller
              </button>
              <button type="button" className="button" style={{ fontSize: '.8rem', minHeight: '32px', padding: '4px 10px' }} onClick={() => fillDemo('delivery@unloss.local', '/delivery-portal')}>
                Delivery Person
              </button>
              <button type="button" className="button" style={{ fontSize: '.8rem', minHeight: '32px', padding: '4px 10px' }} onClick={() => fillDemo('customer@unloss.local', '/customer-portal')}>
                Customer
              </button>
              <button type="button" className="button" style={{ fontSize: '.8rem', minHeight: '32px', padding: '4px 10px' }} onClick={() => fillDemo('admin@unloss.local', '/admin')}>
                Admin
              </button>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="form-stack">
          <label>Email address
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              disabled={pending}
            />
          </label>
          <label>Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={pending}
            />
          </label>
          {error && <ErrorBox message={error} />}
          <button className="button primary full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="login-note">Protected role-based authentication · Persistent PostgreSQL session</p>
        {DEMO_ENABLED && <p className="login-note"><Link to="/demo">Explore isolated synthetic workflow preview</Link></p>}
      </div>
    </main>
  );
}
