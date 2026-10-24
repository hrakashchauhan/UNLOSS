import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Compass,
  CreditCard,
  MapPin,
  Package,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  UserCheck,
} from 'lucide-react';
import { api, type Order } from '../../api';
import { ErrorBox, errText } from '../../ui/common';
import { useAuth } from '../auth/Auth';
import { LiveIndicator } from '../../ui/LiveIndicator';

interface ClaimItem {
  id: string;
  orderId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  order: Order;
  claimedAt: string;
  rejectionReason?: string;
}

interface EarningItem {
  id: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  status: string;
  availableAt: string | null;
  createdAt: string;
  order: { sellerReference?: string; customerName?: string };
}

interface PayoutAccountData {
  method: 'UPI' | 'BANK';
  upiId?: string;
  accountName?: string;
  accountNumberLast4?: string;
  ifsc?: string;
  status: string;
}

export function DeliveryDashboard() {
  const { user, mode, signOut, switchRole } = useAuth();
  const [activeTab, setActiveTab] = useState<'deliveries' | 'claims' | 'earnings' | 'scan'>('deliveries');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [earnings, setEarnings] = useState<EarningItem[]>([]);
  const [eligiblePaise, setEligiblePaise] = useState(0);
  const [payoutAccount, setPayoutAccount] = useState<PayoutAccountData | null>(null);

  // Claim action state
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string>('');

  // QR scan/enter token state
  const [manualToken, setManualToken] = useState('');

  // Payout configuration form
  const [payoutMethod, setPayoutMethod] = useState<'UPI' | 'BANK'>('UPI');
  const [upiId, setUpiId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);

  const reviewStatus = user?.deliveryStatus || 'APPROVED';

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [pendingRes, earningsRes] = await Promise.allSettled([
        api<{ items: Order[] }>('/delivery/pending'),
        api<{ items: EarningItem[]; eligiblePaise: number; payoutAccount: PayoutAccountData | null }>('/delivery/earnings'),
      ]);
      if (pendingRes.status === 'fulfilled') {
        setPendingOrders(pendingRes.value.items || []);
      }
      if (earningsRes.status === 'fulfilled') {
        setEarnings(earningsRes.value.items || []);
        setEligiblePaise(earningsRes.value.eligiblePaise || 0);
        setPayoutAccount(earningsRes.value.payoutAccount || null);
        if (earningsRes.value.payoutAccount?.upiId) setUpiId(earningsRes.value.payoutAccount.upiId);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleClaim(orderId: string) {
    setClaimingId(orderId);
    setError('');
    setActionSuccess('');
    setLocationStatus('Capturing location evidence…');

    let coords: { latitude?: number; longitude?: number; accuracyMeters?: number } = {};

    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 });
        });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        };
        setLocationStatus(`Location verified (accuracy: ±${Math.round(pos.coords.accuracy)}m)`);
      } catch {
        setLocationStatus('Location permission denied/unavailable; submitting with permission status flag.');
      }
    }

    try {
      await api(`/orders/${orderId}/claim`, {
        method: 'POST',
        body: JSON.stringify(coords),
      });
      setActionSuccess(`Parcel claim submitted successfully for ${orderId}. Awaiting seller approval.`);
      await loadData();
    } catch (e) {
      setError(errText(e));
    } finally {
      setClaimingId(null);
    }
  }

  async function savePayoutDestination(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    setError('');
    try {
      const res = await api<{ account: PayoutAccountData }>('/delivery/payout-account', {
        method: 'POST',
        body: JSON.stringify({
          method: payoutMethod,
          upiId: payoutMethod === 'UPI' ? upiId : undefined,
          accountName: accountName || undefined,
        }),
      });
      setPayoutAccount(res.account);
      setActionSuccess('Payout destination saved successfully.');
    } catch (e) {
      setError(errText(e));
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top / Mobile navigation bar */}
      <main className="main-area" style={{ flex: 1, padding: '24px 32px' }}>
        <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="brand-mark" style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>u</div>
              <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>unloss<span className="brand-dot">.</span></span>
            </div>
            <span style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '3px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '.82rem' }}>
              DELIVERY AGENT PORTAL
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <LiveIndicator onLiveEvent={() => void loadData()} />
            {mode === 'demo' && user?.roles.includes('ADMIN') && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('SELLER')}>
                  Switch to Seller
                </button>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('CUSTOMER')}>
                  Switch to Customer
                </button>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('ADMIN')}>
                  Switch to Admin
                </button>
              </div>
            )}
            <div className="avatar small" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
              {user?.name?.slice(0, 1) || 'D'}
            </div>
            <button className="button" style={{ minHeight: '34px', fontSize: '.8rem' }} onClick={() => signOut()}>
              Sign Out
            </button>
          </div>
        </header>

        {mode === 'demo' && user?.roles.includes('ADMIN') && (
          <div className="notice" style={{ marginBottom: '20px', padding: '10px 14px', borderRadius: '4px' }}>
            <b>DATABASE-BACKED LOCAL DEMO · DELIVERY PERSON SESSION</b> — Persistent claims, GPS evidence verification, customer OTP handoff, and internal ₹5 ledger earnings.
          </div>
        )}

        {error && <ErrorBox message={error} />}
        {actionSuccess && (
          <div style={{ background: '#e8f5ec', color: '#1a6840', padding: '10px 14px', borderRadius: '4px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Account Review Status Header */}
        <section className="panel" style={{ padding: '18px 24px', marginBottom: '24px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div className="eyebrow" style={{ color: 'var(--muted)', fontSize: '.8rem', letterSpacing: '.06em' }}>DELIVERY PROFILE</div>
              <h2 style={{ margin: '4px 0 2px', fontSize: '1.25rem' }}>{user?.name || 'Authorized Delivery Partner'}</h2>
              <small className="muted">{user?.phone || '+91 98765 43211'} · Swift Express Logistics · Ref: SWIFT-DEL-042</small>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Account Review Status:</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontWeight: 700,
                  fontSize: '.85rem',
                  background: reviewStatus === 'APPROVED' ? '#e8f5ec' : reviewStatus === 'PENDING' ? '#fef7e6' : '#fff0ed',
                  color: reviewStatus === 'APPROVED' ? '#1a6840' : reviewStatus === 'PENDING' ? '#8a5a00' : '#9f3526',
                }}
              >
                {reviewStatus === 'APPROVED' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                {reviewStatus}
              </span>
            </div>
          </div>
        </section>

        {/* Tab Controls */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--line)', marginBottom: '20px' }}>
          <button
            className={`button ${activeTab === 'deliveries' ? 'primary' : ''}`}
            style={{ borderRadius: '4px 4px 0 0', minHeight: '38px', fontSize: '.88rem' }}
            onClick={() => setActiveTab('deliveries')}
          >
            <Truck size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Available Deliveries ({pendingOrders.length})
          </button>
          <button
            className={`button ${activeTab === 'scan' ? 'primary' : ''}`}
            style={{ borderRadius: '4px 4px 0 0', minHeight: '38px', fontSize: '.88rem' }}
            onClick={() => setActiveTab('scan')}
          >
            <QrCode size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Scan / Enter Delivery QR
          </button>
          <button
            className={`button ${activeTab === 'earnings' ? 'primary' : ''}`}
            style={{ borderRadius: '4px 4px 0 0', minHeight: '38px', fontSize: '.88rem' }}
            onClick={() => setActiveTab('earnings')}
          >
            <Award size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Earnings & Rewards (₹{(eligiblePaise / 100).toFixed(2)})
          </button>
        </div>

        {/* Tab 1: Available Deliveries */}
        {activeTab === 'deliveries' && (
          <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Parcels Out For Delivery</h3>
                <small className="muted">Parcels dispatched by sellers ready for authorized claim and physical verification.</small>
              </div>
              <button className="button" style={{ minHeight: '32px', fontSize: '.8rem' }} onClick={loadData} disabled={loading}>
                <RefreshCw size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {locationStatus && (
              <div style={{ fontSize: '.85rem', color: 'var(--muted)', background: 'var(--background)', padding: '6px 10px', borderRadius: '4px', marginBottom: '12px' }}>
                <Compass size={13} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                {locationStatus}
              </div>
            )}

            {pendingOrders.length === 0 ? (
              <div className="empty-state" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                <Package size={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No parcels currently waiting for claims.</p>
                <small>When a seller marks an order as <b>Out for Delivery</b>, it will immediately appear here.</small>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {pendingOrders.map(order => (
                  <div
                    key={order.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      padding: '14px 18px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--surface-warm)',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <b style={{ fontSize: '.95rem' }}>{order.sellerReference || order.id}</b>
                        <span style={{ fontSize: '.75rem', padding: '2px 6px', borderRadius: '4px', background: '#e6f3f3', color: 'var(--primary)', fontWeight: 600 }}>
                          {order.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                        <MapPin size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                        {order.deliveryAddress?.line1 || (order as any).addressLine1}, {order.deliveryAddress?.city || (order as any).city}, {order.deliveryAddress?.state || (order as any).state} {order.deliveryAddress?.postalCode || (order as any).postalCode}
                      </div>
                      <small style={{ color: 'var(--muted)' }}>
                        Recipient: <b>{order.customer?.name || (order as any).customerName}</b> · Attempt #{(order as any).deliveryAttempt ?? 0}
                      </small>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="button primary"
                        style={{ fontSize: '.85rem', minHeight: '36px' }}
                        disabled={claimingId === order.id}
                        onClick={() => handleClaim(order.id)}
                      >
                        {claimingId === order.id ? 'Claiming with GPS…' : 'Claim Parcel'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Scan / Enter Delivery QR */}
        {activeTab === 'scan' && (
          <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', maxWidth: '640px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>Scan or Enter Delivery QR Token</h3>
            <p className="muted" style={{ fontSize: '.86rem', marginTop: 0 }}>
              Each parcel generated by the seller includes a dedicated <b>Delivery QR</b>. Scan the code on the parcel label or enter the 43-character token to open the authorized delivery handoff screen.
            </p>

            <form
              onSubmit={e => {
                e.preventDefault();
                if (!manualToken.trim()) return;
                const token = manualToken.trim().split('/').pop() || '';
                window.location.href = `/delivery/${encodeURIComponent(token)}`;
              }}
              className="form-stack"
              style={{ marginTop: '16px' }}
            >
              <label>
                Delivery QR Token or Scanned URL
                <input
                  type="text"
                  placeholder="Paste URL or 43-character Delivery token…"
                  value={manualToken}
                  onChange={e => setManualToken(e.target.value)}
                  required
                />
              </label>
              <button className="button primary" style={{ minHeight: '40px' }}>
                Open Authorized Delivery Workflow
              </button>
            </form>

            <div style={{ marginTop: '24px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
              <div className="eyebrow" style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: '8px' }}>DELIVERY AGENT VERIFICATION PRINCIPLE:</div>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                Scanning a QR code records authorized arrival but does <b>not</b> constitute proof of delivery. To complete the delivery and receive the ₹5 reward, you must collect the customer's fresh 6-digit OTP and submit verified handoff.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Earnings & Rewards */}
        {activeTab === 'earnings' && (
          <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {/* Balance & Ledger */}
            <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
              <div className="eyebrow" style={{ color: 'var(--muted)' }}>EARNINGS LEDGER</div>
              <h2 style={{ fontSize: '1.8rem', color: 'var(--primary)', margin: '8px 0 4px' }}>
                ₹{(eligiblePaise / 100).toFixed(2)}
              </h2>
              <small className="muted" style={{ display: 'block', marginBottom: '16px' }}>
                Earned from verified customer handoffs (₹5.00 per eligible parcel).
              </small>

              <h4 style={{ margin: '16px 0 8px', fontSize: '.92rem' }}>Recent Delivery Credits:</h4>
              {earnings.length === 0 ? (
                <p className="muted" style={{ fontSize: '.86rem' }}>No reward credits recorded yet. Complete customer verification handoffs to earn rewards.</p>
              ) : (
                <div style={{ display: 'grid', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                  {earnings.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'var(--background)',
                        borderRadius: '4px',
                        fontSize: '.85rem',
                      }}
                    >
                      <div>
                        <b>{item.order?.sellerReference || item.orderId}</b>
                        <small className="muted" style={{ display: 'block' }}>{new Date(item.createdAt).toLocaleString()}</small>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <b style={{ color: '#1a6840' }}>+₹{(item.amountPaise / 100).toFixed(2)}</b>
                        <small className="muted" style={{ display: 'block' }}>{item.status}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payout Destination */}
            <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
              <div className="eyebrow" style={{ color: 'var(--muted)' }}>PAYMENT DESTINATION</div>
              <h3 style={{ margin: '8px 0 12px', fontSize: '1.1rem' }}>Payout Method & Bank Details</h3>
              <p className="muted" style={{ fontSize: '.85rem', margin: '0 0 16px' }}>
                Set your UPI ID or bank account for scheduled weekly batch payouts. Payouts are reconciled via sandbox payment worker.
              </p>

              <form onSubmit={savePayoutDestination} className="form-stack">
                <label>
                  Payout Method
                  <select value={payoutMethod} onChange={e => setPayoutMethod(e.target.value as any)}>
                    <option value="UPI">UPI ID (Instant Transfer)</option>
                    <option value="BANK">Bank Account (NEFT/IMPS)</option>
                  </select>
                </label>

                {payoutMethod === 'UPI' ? (
                  <label>
                    UPI ID / VPA
                    <input
                      type="text"
                      placeholder="e.g. yourname@okhdfcbank"
                      value={upiId}
                      onChange={e => setUpiId(e.target.value)}
                      required
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      Account Holder Name
                      <input
                        type="text"
                        placeholder="Full legal name"
                        value={accountName}
                        onChange={e => setAccountName(e.target.value)}
                        required
                      />
                    </label>
                  </>
                )}

                <button className="button primary" style={{ minHeight: '38px', marginTop: '8px' }} disabled={savingAccount}>
                  {savingAccount ? 'Saving…' : 'Save Payout Destination'}
                </button>
              </form>

              {payoutAccount && (
                <div style={{ marginTop: '16px', padding: '10px 12px', background: 'var(--primary-light)', borderRadius: '4px', fontSize: '.85rem' }}>
                  <b>Active Account:</b> {payoutAccount.method} · {payoutAccount.upiId || payoutAccount.accountName} ({payoutAccount.status})
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
