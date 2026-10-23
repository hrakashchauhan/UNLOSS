import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, registerSellerSessionExpired, type Seller } from '../../api';
import { ErrorBox, errText } from '../../ui/common';
import { DEMO_ENABLED } from '../../config';

type AuthPhase = 'checking' | 'authenticated' | 'unauthenticated' | 'error';
interface AuthContextValue {
  seller: Seller | null;
  phase: AuthPhase;
  restore: (signal?: AbortSignal) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
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
  const [phase, setPhase] = useState<AuthPhase>('checking');

  const restore = useCallback(async (signal?: AbortSignal) => {
    setPhase('checking');
    try {
      const response = await api<{ seller: Seller }>('/auth/me', { signal });
      if (!response.seller?.id) throw new ApiError(200, 'INVALID_RESPONSE', 'The server returned an invalid seller session.');
      if (!signal?.aborted) { setSeller(response.seller); setPhase('authenticated'); }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setSeller(null);
      setPhase(error instanceof ApiError && error.status === 401 ? 'unauthenticated' : 'error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    registerSellerSessionExpired(() => { setSeller(null); setPhase('unauthenticated'); });
    void restore(controller.signal);
    return () => { controller.abort(); registerSellerSessionExpired(); };
  }, [restore]);

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await api<{ seller: Seller }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!response.seller?.id) throw new ApiError(200, 'INVALID_RESPONSE', 'The server returned an invalid seller session.');
    setSeller(response.seller);
    setPhase('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try { await api<void>('/auth/logout', { method: 'POST' }); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    setSeller(null);
    setPhase('unauthenticated');
  }, []);

  const value = useMemo(() => ({ seller, phase, restore, signIn, signOut }), [seller, phase, restore, signIn, signOut]);
  return <AuthContext.Provider value={value}><Outlet /></AuthContext.Provider>;
}

function SessionStatus() {
  const { restore } = useAuth();
  const [retrying, setRetrying] = useState(false);
  async function retry() { setRetrying(true); try { await restore(); } finally { setRetrying(false); } }
  return <main className="recovery-screen"><h1>Unable to check your session</h1><p>The API is unavailable. Your sign-in status is unknown.</p><button className="button primary" disabled={retrying} onClick={retry}>{retrying ? 'Checking…' : 'Try again'}</button></main>;
}

export function RequireSeller() {
  const { seller, phase } = useAuth();
  const location = useLocation();
  if (phase === 'checking') return <main className="splash" role="status">Preparing your workspace…</main>;
  if (phase === 'error') return <SessionStatus />;
  if (phase !== 'authenticated' || !seller) return <Navigate replace to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)} />;
  return <Outlet />;
}

function safeReturnTo(requested: string | null) {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//') || requested.includes('\\') || [...requested].some(character => character.charCodeAt(0) < 32) || /^\/(login|customer|delivery)(\/|\?|$)/.test(requested)) return '/dashboard';
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      await signIn(String(form.get('email') || '').trim(), String(form.get('password') || ''));
      navigate(returnTo, { replace: true });
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }
  return <main className="login-screen"><div className="login-card">
    <div className="brand login-brand"><div className="brand-mark">u</div><span>unloss<span className="brand-dot">.</span></span></div>
    <div className="eyebrow">SELLER WORKSPACE</div><h1>Welcome back</h1>
    <p className="muted">Sign in to manage your delivery operations.</p>
    <form onSubmit={submit} className="form-stack">
      <label>Email address<input name="email" type="email" autoComplete="username" placeholder="you@company.com" required disabled={pending} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required disabled={pending} /></label>
      {error && <ErrorBox message={error} />}
      <button className="button primary full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="login-note">Seller-only access</p>{DEMO_ENABLED && <p className="login-note"><Link to="/demo">Explore the synthetic workflow demo</Link></p>}
  </div></main>;
}
