import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Package,
  QrCode,
  RefreshCw,
  RotateCcw,
  Shield,
  Truck,
  XCircle,
} from 'lucide-react';
import { api, type Order } from '../../api';
import { ErrorBox, errText } from '../../ui/common';
import { useAuth } from '../auth/Auth';
import { LiveIndicator } from '../../ui/LiveIndicator';

export function CustomerDashboard() {
  const { user, mode, signOut, switchRole } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  async function loadCustomerOrders() {
    setLoading(true);
    setError('');
    try {
      // In demo mode or production customer view, get customer-relevant active orders
      const res = await api<{ items: Order[] }>('/orders?limit=25');
      setOrders(res.items || []);
      if (res.items?.length > 0 && !selectedOrder) {
        setSelectedOrder(res.items[0]);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomerOrders();
  }, []);

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
      <main className="main-area" style={{ flex: 1, padding: '24px 32px' }}>
        <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="brand-mark" style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>u</div>
              <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>unloss<span className="brand-dot">.</span></span>
            </div>
            <span style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '3px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '.82rem' }}>
              CUSTOMER DELIVERY PORTAL
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <LiveIndicator onLiveEvent={() => void loadCustomerOrders()} />
            {mode === 'demo' && user?.roles.includes('ADMIN') && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('SELLER')}>
                  Switch to Seller
                </button>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('DELIVERY')}>
                  Switch to Delivery
                </button>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('ADMIN')}>
                  Switch to Admin
                </button>
              </div>
            )}
            <div className="avatar small" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
              {user?.name?.slice(0, 1) || 'C'}
            </div>
            <button className="button" style={{ minHeight: '34px', fontSize: '.8rem' }} onClick={() => signOut()}>
              Sign Out
            </button>
          </div>
        </header>

        {mode === 'demo' && user?.roles.includes('ADMIN') && (
          <div className="notice" style={{ marginBottom: '20px', padding: '10px 14px', borderRadius: '4px' }}>
            <b>DATABASE-BACKED LOCAL DEMO · CUSTOMER SESSION</b> — View your incoming parcels, track progress, scan your private Customer QR, and verify delivery receipt with a fresh OTP.
          </div>
        )}

        {error && <ErrorBox message={error} />}

        {/* Quick QR Token Jump */}
        <section className="panel" style={{ padding: '18px 24px', marginBottom: '24px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div className="eyebrow" style={{ color: 'var(--muted)' }}>VERIFY YOUR PARCEL</div>
              <h2 style={{ margin: '4px 0 2px', fontSize: '1.2rem' }}>Scan or Enter Customer Verification QR</h2>
              <small className="muted">Your private Customer QR token opens your attempt-scoped OTP verification page.</small>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                if (!manualToken.trim()) return;
                const token = manualToken.trim().split('/').pop() || '';
                window.location.href = `/customer/${encodeURIComponent(token)}`;
              }}
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
            >
              <input
                type="text"
                placeholder="Paste Customer QR token or URL…"
                value={manualToken}
                onChange={e => setManualToken(e.target.value)}
                style={{ minHeight: '38px', minWidth: '260px', padding: '6px 10px' }}
                required
              />
              <button className="button primary" style={{ minHeight: '38px', fontSize: '.88rem' }}>
                Open Verification
              </button>
            </form>
          </div>
        </section>

        {/* Deliveries Grid / Timeline */}
        <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(300px, 1fr) minmax(360px, 1.4fr)' }}>
          {/* Parcel List */}
          <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Your Incoming Deliveries ({orders.length})</h3>
              <button className="button" style={{ minHeight: '32px', fontSize: '.8rem' }} onClick={loadCustomerOrders} disabled={loading}>
                <RefreshCw size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="empty-state" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                <Package size={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No active deliveries found.</p>
                <small>Orders addressed to your contact will be tracked here.</small>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {orders.map(order => {
                  const isSelected = selectedOrder?.id === order.id;
                  return (
                    <div
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '6px',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--line)',
                        background: isSelected ? 'var(--primary-light)' : 'var(--surface)',
                        cursor: 'pointer',
                        transition: 'border-color .15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <b style={{ fontSize: '.92rem' }}>{order.sellerReference || order.id}</b>
                        <span
                          style={{
                            fontSize: '.75rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            background: order.status === 'DELIVERED_VERIFIED' ? '#e8f5ec' : '#eaecf0',
                            color: order.status === 'DELIVERED_VERIFIED' ? '#1a6840' : 'var(--text)',
                          }}
                        >
                          {order.status}
                        </span>
                      </div>
                      <small className="muted" style={{ display: 'block' }}>
                        {order.deliveryAddress?.line1 || (order as any).addressLine1}, {order.deliveryAddress?.city || (order as any).city} · Attempt #{(order as any).deliveryAttempt ?? 0}
                      </small>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Delivery Details & Actions */}
          <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
            {selectedOrder ? (
              <div>
                <div className="eyebrow" style={{ color: 'var(--muted)' }}>PARCEL DETAIL</div>
                <h3 style={{ margin: '4px 0 12px', fontSize: '1.2rem' }}>{selectedOrder.sellerReference || selectedOrder.id}</h3>

                <div style={{ background: 'var(--surface-warm)', padding: '14px', borderRadius: '6px', border: '1px solid var(--line)', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', fontSize: '.86rem' }}>
                    <div>
                      <span className="muted" style={{ display: 'block' }}>Current Status:</span>
                      <b>{selectedOrder.status}</b>
                    </div>
                    <div>
                      <span className="muted" style={{ display: 'block' }}>Recipient:</span>
                      <b>{selectedOrder.customer?.name || (selectedOrder as any).customerName}</b>
                    </div>
                    <div>
                      <span className="muted" style={{ display: 'block' }}>Delivery Attempt:</span>
                      <b>#{(selectedOrder as any).deliveryAttempt ?? 0}</b>
                    </div>
                    <div>
                      <span className="muted" style={{ display: 'block' }}>Destination:</span>
                      <b>{selectedOrder.deliveryAddress?.city || (selectedOrder as any).city}, {selectedOrder.deliveryAddress?.state || (selectedOrder as any).state}</b>
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: '.95rem' }}>Customer Actions:</h4>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <p className="muted" style={{ fontSize: '.85rem', margin: 0 }}>
                      To accept the package, verify with fresh OTP, reject with reason, or schedule a redelivery, open the private verification screen associated with this shipment's token.
                    </p>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: '.95rem' }}>Shipment Accountability Guarantee:</h4>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                    <li>A delivery scan alone never marks an order complete.</li>
                    <li>Acceptance is strictly bound to your fresh 6-digit OTP code.</li>
                    <li>If damaged or wrong item, select <b>Reject with Reason</b> to initiate return.</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--muted)' }}>
                <Package size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p>Select a delivery on the left to inspect its timeline and verification controls.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
