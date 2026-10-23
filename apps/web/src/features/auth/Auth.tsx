import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Truck, Store, UserCheck, Smartphone, Mail, ArrowRight, CheckCircle2 } from 'lucide-react';
import { ApiError, api, registerSellerSessionExpired, type Seller } from '../../api';
import { ErrorBox, errText } from '../../ui/common';
import { DEMO_ENABLED } from '../../config';
import { GoogleSignIn } from './GoogleSignIn';

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
  register: (payload: any) => Promise<void>;
  signInWithGoogle: (credential: string, role?: UserRole) => Promise<void>;
  requestPhoneOtp: (phone: string) => Promise<{ challengeId: string; phone: string; devCode: string; message: string }>;
  verifyPhoneOtp: (phone: string, code: string, role?: UserRole, name?: string) => Promise<void>;
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

  const register = useCallback(async (payload: any) => {
    const response = await api<{ seller?: Seller | null; user?: AuthUser | null; mode?: 'demo' | 'manual' }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setSeller(response.seller || null);
    setUser(response.user || null);
    setMode(response.mode === 'demo' ? 'demo' : 'manual');
    setPhase('authenticated');
  }, []);

  const signInWithGoogle = useCallback(async (credential: string, role: UserRole = 'CUSTOMER') => {
    const response = await api<{ seller?: Seller | null; user?: AuthUser | null; mode?: 'demo' | 'manual' }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential, role }),
    });
    setSeller(response.seller || null);
    setUser(response.user || null);
    setMode(response.mode === 'demo' ? 'demo' : 'manual');
    setPhase('authenticated');
  }, []);

  const requestPhoneOtp = useCallback(async (phone: string) => {
    return api<{ challengeId: string; phone: string; devCode: string; message: string }>('/auth/phone/otp-request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }, []);

  const verifyPhoneOtp = useCallback(async (phone: string, code: string, role: UserRole = 'CUSTOMER', name?: string) => {
    const response = await api<{ seller?: Seller | null; user?: AuthUser | null; mode?: 'demo' | 'manual' }>('/auth/phone/otp-login', {
      method: 'POST',
      body: JSON.stringify({ phone, code, role, name }),
    });
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

  const value = useMemo(() => ({
    seller,
    user,
    mode,
    phase,
    restore,
    signIn,
    register,
    signInWithGoogle,
    requestPhoneOtp,
    verifyPhoneOtp,
    switchRole,
    signOut,
  }), [seller, user, mode, phase, restore, signIn, register, signInWithGoogle, requestPhoneOtp, verifyPhoneOtp, switchRole, signOut]);

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
        <div className="eyebrow" style={{ color: '#047857', fontWeight: 700 }}>ROLE RESTRICTED</div>
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
  const { phase, user, seller } = useAuth();
  const [searchParams] = useSearchParams();
  const target = safeReturnTo(searchParams.get('returnTo'));

  if (phase === 'checking') return <main className="splash" role="status">Checking your session…</main>;
  if (phase === 'error') return <SessionStatus />;
  if (phase === 'authenticated') {
    // If returning to a specific role, route intelligently
    if (user?.roles?.includes('DELIVERY') && !seller) return <Navigate replace to="/delivery-portal" />;
    if (user?.roles?.includes('CUSTOMER') && !seller && !user.roles.includes('DELIVERY')) return <Navigate replace to="/customer-portal" />;
    return <Navigate replace to={target} />;
  }
  return <AuthView returnTo={target} />;
}

function AuthView({ returnTo }: { returnTo: string }) {
  const { signIn, register, signInWithGoogle, requestPhoneOtp, verifyPhoneOtp } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'signin' | 'register' | 'phone'>('signin');
  const [selectedRole, setSelectedRole] = useState<'SELLER' | 'DELIVERY' | 'CUSTOMER'>('SELLER');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  // Email Sign In State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register State
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [employer, setEmployer] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Phone OTP State
  const [phoneInput, setPhoneInput] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devOtp, setDevOtp] = useState('');
  const [otpMessage, setOtpMessage] = useState('');

  function routeUser(role: string) {
    if (role === 'DELIVERY') navigate('/delivery-portal', { replace: true });
    else if (role === 'CUSTOMER') navigate('/customer-portal', { replace: true });
    else navigate(returnTo || '/dashboard', { replace: true });
  }

  // Handle Standard Sign In
  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    try {
      await signIn(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }

  // Handle Registration for 3 User Roles
  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    try {
      await register({
        name: regName.trim(),
        email: regEmail.trim() || undefined,
        phone: regPhone.trim() || undefined,
        password: regPassword,
        role: selectedRole,
        employer: selectedRole === 'DELIVERY' ? employer.trim() || 'Express Courier' : undefined,
        deliveryReference: selectedRole === 'DELIVERY' ? deliveryRef.trim() || undefined : undefined,
        addressLine1: selectedRole === 'CUSTOMER' ? addressLine1.trim() || undefined : undefined,
        city: selectedRole === 'CUSTOMER' ? city.trim() || undefined : undefined,
        state: selectedRole === 'CUSTOMER' ? state.trim() || undefined : undefined,
        postalCode: selectedRole === 'CUSTOMER' ? postalCode.trim() || undefined : undefined,
      });
      routeUser(selectedRole);
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }

  // Handle Google Sign In
  async function handleGoogleSignIn(credential: string) {
    if (pending) return;
    setPending(true); setError('');
    try {
      await signInWithGoogle(credential, selectedRole);
      routeUser(selectedRole);
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }

  // Handle Request Phone OTP
  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    if (!phoneInput || pending) return;
    setPending(true); setError('');
    try {
      const res = await requestPhoneOtp(phoneInput.trim());
      setOtpSent(true);
      setDevOtp(res.devCode);
      setOtpMessage(res.message);
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }

  // Handle Verify Phone OTP
  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!otpCode || pending) return;
    setPending(true); setError('');
    try {
      await verifyPhoneOtp(phoneInput.trim(), otpCode.trim(), selectedRole);
      routeUser(selectedRole);
    } catch (cause) { setError(errText(cause)); }
    finally { setPending(false); }
  }

  function fillDemo(demoEmail: string, targetPath: string) {
    setEmail(demoEmail);
    setPassword('0wEU9db2P063yo_R0GsEr4NP');
    setActiveTab('signin');
    if (returnTo === '/dashboard' && targetPath !== '/dashboard') {
      navigate(`/login?returnTo=${encodeURIComponent(targetPath)}`, { replace: true });
    }
  }

  return (
    <main className="login-screen" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: '#f8fafc' }}>
      <div className="login-card" style={{ width: '100%', maxWidth: '480px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '32px 28px', boxShadow: '0 4px 12px -2px rgba(0,0,0,0.06)' }}>
        
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          <div style={{ width: '32px', height: '32px', background: '#047857', borderRadius: '8px', color: '#ffffff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '18px' }}>
            u
          </div>
          <span style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: '#0f172a' }}>
            unloss<span style={{ color: '#10b981' }}>.</span>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 8px', borderRadius: '12px', fontWeight: 700 }}>
            PARCEL VERIFICATION
          </span>
        </div>

        <h1 style={{ fontSize: '24px', margin: '4px 0 6px', color: '#0f172a' }}>Welcome back</h1>
        <p className="muted" style={{ fontSize: '13px', margin: '0 0 16px' }}>Sign in to your role-based delivery accountability workspace.</p>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
          <button
            type="button"
            onClick={() => { setActiveTab('signin'); setError(''); }}
            style={{
              flex: 1,
              padding: '10px 0',
              textAlign: 'center',
              fontSize: '13px',
              fontWeight: activeTab === 'signin' ? 700 : 500,
              color: activeTab === 'signin' ? '#047857' : '#64748b',
              borderBottom: activeTab === 'signin' ? '2px solid #047857' : '2px solid transparent',
              background: 'none',
              borderTop: 0, borderLeft: 0, borderRight: 0,
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('register'); setError(''); }}
            style={{
              flex: 1,
              padding: '10px 0',
              textAlign: 'center',
              fontSize: '13px',
              fontWeight: activeTab === 'register' ? 700 : 500,
              color: activeTab === 'register' ? '#047857' : '#64748b',
              borderBottom: activeTab === 'register' ? '2px solid #047857' : '2px solid transparent',
              background: 'none',
              borderTop: 0, borderLeft: 0, borderRight: 0,
            }}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('phone'); setError(''); }}
            style={{
              flex: 1,
              padding: '10px 0',
              textAlign: 'center',
              fontSize: '13px',
              fontWeight: activeTab === 'phone' ? 700 : 500,
              color: activeTab === 'phone' ? '#047857' : '#64748b',
              borderBottom: activeTab === 'phone' ? '2px solid #047857' : '2px solid transparent',
              background: 'none',
              borderTop: 0, borderLeft: 0, borderRight: 0,
            }}
          >
            Phone OTP
          </button>
        </div>

        {/* Quick Demo Fill Pill Box */}
        {DEMO_ENABLED && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Quick Test Roles:
              </span>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>1-click fill</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              <button type="button" className="button subtle" style={{ fontSize: '11px', padding: '4px', minHeight: '30px' }} onClick={() => fillDemo('demo@unloss.local', '/dashboard')}>
                Seller
              </button>
              <button type="button" className="button subtle" style={{ fontSize: '11px', padding: '4px', minHeight: '30px' }} onClick={() => fillDemo('delivery@unloss.local', '/delivery-portal')}>
                Courier
              </button>
              <button type="button" className="button subtle" style={{ fontSize: '11px', padding: '4px', minHeight: '30px' }} onClick={() => fillDemo('customer@unloss.local', '/customer-portal')}>
                Customer
              </button>
              <button type="button" className="button subtle" style={{ fontSize: '11px', padding: '4px', minHeight: '30px' }} onClick={() => fillDemo('admin@unloss.local', '/admin')}>
                Admin
              </button>
            </div>
          </div>
        )}

        {/* Google Sign-In Button */}
        <div style={{ marginBottom: '20px' }}>
          <GoogleSignIn onCredential={handleGoogleSignIn} />
          <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0', color: '#94a3b8', fontSize: '11px' }}>
            <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
            <span style={{ padding: '0 10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>or with credentials</span>
            <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
          </div>
        </div>

        {/* 1. SIGN IN TAB */}
        {activeTab === 'signin' && (
          <form onSubmit={handleSignIn} className="form-stack">
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
              Email address
              <input
                name="email"
                type="text"
                required
                autoComplete="username"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={pending}
                style={{ borderRadius: '6px', borderColor: '#cbd5e1' }}
              />
            </label>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={pending}
                style={{ borderRadius: '6px', borderColor: '#cbd5e1' }}
              />
            </label>
            {error && <ErrorBox message={error} />}
            <button className="button primary full" disabled={pending} style={{ minHeight: '42px', fontWeight: 700 }}>
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {/* 2. REGISTRATION TAB (3 User Roles) */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className="form-stack">
            {/* Role Selector Cards */}
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '8px' }}>
                SELECT YOUR ACCOUNT ROLE:
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedRole('SELLER')}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '8px',
                    border: selectedRole === 'SELLER' ? '2px solid #047857' : '1px solid #e2e8f0',
                    background: selectedRole === 'SELLER' ? '#ecfdf5' : '#ffffff',
                    color: selectedRole === 'SELLER' ? '#047857' : '#475569',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Store size={18} style={{ margin: '0 auto 4px' }} />
                  <div style={{ fontSize: '11px', fontWeight: 700 }}>Seller</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedRole('DELIVERY')}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '8px',
                    border: selectedRole === 'DELIVERY' ? '2px solid #047857' : '1px solid #e2e8f0',
                    background: selectedRole === 'DELIVERY' ? '#ecfdf5' : '#ffffff',
                    color: selectedRole === 'DELIVERY' ? '#047857' : '#475569',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Truck size={18} style={{ margin: '0 auto 4px' }} />
                  <div style={{ fontSize: '11px', fontWeight: 700 }}>Delivery Guy</div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedRole('CUSTOMER')}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '8px',
                    border: selectedRole === 'CUSTOMER' ? '2px solid #047857' : '1px solid #e2e8f0',
                    background: selectedRole === 'CUSTOMER' ? '#ecfdf5' : '#ffffff',
                    color: selectedRole === 'CUSTOMER' ? '#047857' : '#475569',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <UserCheck size={18} style={{ margin: '0 auto 4px' }} />
                  <div style={{ fontSize: '11px', fontWeight: 700 }}>Customer</div>
                </button>
              </div>
            </div>

            {/* Common Fields */}
            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              Full Name / Organization
              <input
                type="text"
                required
                placeholder={selectedRole === 'SELLER' ? 'Apex Goods Inc.' : selectedRole === 'DELIVERY' ? 'Alex Rivera' : 'Rahul Sharma'}
                value={regName}
                onChange={e => setRegName(e.target.value)}
                disabled={pending}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Email address
                <input
                  type="email"
                  placeholder="name@domain.com"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  disabled={pending}
                />
              </label>

              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                Phone number
                <input
                  type="tel"
                  placeholder="+919876543210"
                  value={regPhone}
                  onChange={e => setRegPhone(e.target.value)}
                  disabled={pending}
                />
              </label>
            </div>

            <label style={{ fontSize: '12px', fontWeight: 600 }}>
              Set Password
              <input
                type="password"
                required
                placeholder="At least 6 characters"
                value={regPassword}
                onChange={e => setRegPassword(e.target.value)}
                disabled={pending}
              />
            </label>

            {/* Role-Specific Fields */}
            {selectedRole === 'DELIVERY' && (
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'grid', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857' }}>COURIER CREDENTIALS:</span>
                <label style={{ fontSize: '11px', fontWeight: 600 }}>
                  Employer / Courier Agency
                  <input
                    type="text"
                    placeholder="BlueDart, Shadowfax, DTDC, etc."
                    value={employer}
                    onChange={e => setEmployer(e.target.value)}
                  />
                </label>
                <label style={{ fontSize: '11px', fontWeight: 600 }}>
                  Agent Badge / Vehicle ID Reference
                  <input
                    type="text"
                    placeholder="DEL-7892 / KA-01-AB-1234"
                    value={deliveryRef}
                    onChange={e => setDeliveryRef(e.target.value)}
                  />
                </label>
              </div>
            )}

            {selectedRole === 'CUSTOMER' && (
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'grid', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857' }}>DELIVERY ADDRESS:</span>
                <label style={{ fontSize: '11px', fontWeight: 600 }}>
                  Address Line
                  <input
                    type="text"
                    placeholder="Flat 402, Green Residency"
                    value={addressLine1}
                    onChange={e => setAddressLine1(e.target.value)}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 600 }}>
                    City
                    <input
                      type="text"
                      placeholder="Bengaluru"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                    />
                  </label>
                  <label style={{ fontSize: '10px', fontWeight: 600 }}>
                    State
                    <input
                      type="text"
                      placeholder="Karnataka"
                      value={state}
                      onChange={e => setState(e.target.value)}
                    />
                  </label>
                  <label style={{ fontSize: '10px', fontWeight: 600 }}>
                    Pincode
                    <input
                      type="text"
                      placeholder="560001"
                      value={postalCode}
                      onChange={e => setPostalCode(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}

            {error && <ErrorBox message={error} />}

            <button className="button primary full" disabled={pending} style={{ minHeight: '42px', fontWeight: 700 }}>
              {pending ? 'Registering…' : `Register as ${selectedRole === 'SELLER' ? 'Seller' : selectedRole === 'DELIVERY' ? 'Delivery Guy' : 'Customer'}`}
            </button>
          </form>
        )}

        {/* 3. PHONE OTP TAB */}
        {activeTab === 'phone' && (
          <div className="form-stack">
            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="form-stack">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Phone Number
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    disabled={pending}
                  />
                </label>
                {error && <ErrorBox message={error} />}
                <button className="button primary full" disabled={pending} style={{ minHeight: '42px', fontWeight: 700 }}>
                  {pending ? 'Sending code…' : 'Send One-Time Password'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="form-stack">
                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '10px 12px', borderRadius: '6px' }}>
                  <div style={{ fontSize: '12px', color: '#047857', fontWeight: 700 }}>OTP SENT TO {phoneInput}</div>
                  {devOtp && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#065f46' }}>
                      Test Verification Code: <b style={{ fontSize: '14px', letterSpacing: '2px' }}>{devOtp}</b>
                      <button
                        type="button"
                        className="button subtle"
                        style={{ marginLeft: '8px', fontSize: '10px', padding: '2px 8px', minHeight: '24px' }}
                        onClick={() => setOtpCode(devOtp)}
                      >
                        Auto-fill
                      </button>
                    </div>
                  )}
                </div>

                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Enter 6-Digit Code
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="123456"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value)}
                    disabled={pending}
                    style={{ letterSpacing: '4px', fontSize: '18px', textAlign: 'center' }}
                  />
                </label>

                {error && <ErrorBox message={error} />}

                <button className="button primary full" disabled={pending || otpCode.length !== 6} style={{ minHeight: '42px', fontWeight: 700 }}>
                  {pending ? 'Verifying…' : 'Verify & Sign In'}
                </button>

                <button
                  type="button"
                  className="button subtle full"
                  onClick={() => setOtpSent(false)}
                  style={{ minHeight: '34px', fontSize: '11px' }}
                >
                  Use a different phone number
                </button>
              </form>
            )}
          </div>
        )}

        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #f1f5f9', textAlign: 'center', fontSize: '11px', color: '#94a3b8' }}>
          Secure end-to-end parcel verification protocol · Real PostgreSQL persistence
        </div>

      </div>
    </main>
  );
}
