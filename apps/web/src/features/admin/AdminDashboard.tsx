import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Award,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserCheck,
  UserX,
  Users,
  Webhook,
} from 'lucide-react';
import { api } from '../../api';
import { ErrorBox, errText } from '../../ui/common';
import { useAuth } from '../auth/Auth';
import { LiveIndicator } from '../../ui/LiveIndicator';

interface DeliveryAccountItem {
  id: string;
  userId: string;
  employer: string;
  deliveryReference: string;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  phoneVerifiedAt: string | null;
  createdAt: string;
  user: {
    name: string;
    email: string | null;
    phone: string | null;
  };
}

export function AdminDashboard() {
  const { user, mode, signOut, switchRole } = useAuth();
  const [activeTab, setActiveTab] = useState<'delivery-accounts' | 'payouts' | 'integrations'>('delivery-accounts');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<DeliveryAccountItem[]>([]);
  const [actionSuccess, setActionSuccess] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payoutResult, setPayoutResult] = useState<any>(null);
  const [runningPayout, setRunningPayout] = useState(false);

  async function loadAccounts() {
    setLoading(true);
    setError('');
    try {
      const res = await api<{ items: DeliveryAccountItem[] }>('/admin/delivery-accounts');
      setAccounts(res.items || []);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function reviewAccount(id: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    setError('');
    setActionSuccess('');
    try {
      await api(`/admin/delivery-accounts/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      setActionSuccess(`Account ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`);
      setRejectingId(null);
      setRejectReason('');
      await loadAccounts();
    } catch (e) {
      setError(errText(e));
    }
  }

  async function triggerPayoutBatch() {
    setRunningPayout(true);
    setError('');
    try {
      const res = await api('/admin/payouts/run', { method: 'POST' });
      setPayoutResult(res);
      setActionSuccess('Weekly payout batch scheduled successfully.');
    } catch (e) {
      setError(errText(e));
    } finally {
      setRunningPayout(false);
    }
  }

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
      <main className="main-area" style={{ flex: 1, padding: '24px 32px' }}>
        <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="brand-mark" style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>u</div>
              <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>unloss<span className="brand-dot">.</span></span>
            </div>
            <span style={{ background: '#fdf0ed', color: '#9f3526', padding: '3px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '.82rem' }}>
              ADMINISTRATOR CONSOLE
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <LiveIndicator onLiveEvent={() => void loadAccounts()} />
            {mode === 'demo' && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('SELLER')}>
                  Switch to Seller
                </button>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('DELIVERY')}>
                  Switch to Delivery
                </button>
                <button className="button" style={{ minHeight: '34px', fontSize: '.8rem', padding: '4px 10px' }} onClick={() => switchRole('CUSTOMER')}>
                  Switch to Customer
                </button>
              </div>
            )}
            <div className="avatar small" style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#9f3526', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
              {user?.name?.slice(0, 1) || 'A'}
            </div>
            <button className="button" style={{ minHeight: '34px', fontSize: '.8rem' }} onClick={() => signOut()}>
              Sign Out
            </button>
          </div>
        </header>

        {mode === 'demo' && (
          <div className="notice" style={{ marginBottom: '20px', padding: '10px 14px', borderRadius: '4px' }}>
            <b>DATABASE-BACKED LOCAL DEMO · ADMINISTRATOR CONSOLE</b> — Review and authorize delivery agents, inspect integrations & webhooks, and trigger scheduled payout batch runs.
          </div>
        )}

        {error && <ErrorBox message={error} />}
        {actionSuccess && (
          <div style={{ background: '#e8f5ec', color: '#1a6840', padding: '10px 14px', borderRadius: '4px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Tab Selection */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--line)', marginBottom: '20px' }}>
          <button
            className={`button ${activeTab === 'delivery-accounts' ? 'primary' : ''}`}
            style={{ borderRadius: '4px 4px 0 0', minHeight: '38px', fontSize: '.88rem' }}
            onClick={() => setActiveTab('delivery-accounts')}
          >
            <Users size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Delivery Account Reviews ({accounts.length})
          </button>
          <button
            className={`button ${activeTab === 'payouts' ? 'primary' : ''}`}
            style={{ borderRadius: '4px 4px 0 0', minHeight: '38px', fontSize: '.88rem' }}
            onClick={() => setActiveTab('payouts')}
          >
            <Award size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Payout Batches & Ledger
          </button>
          <button
            className={`button ${activeTab === 'integrations' ? 'primary' : ''}`}
            style={{ borderRadius: '4px 4px 0 0', minHeight: '38px', fontSize: '.88rem' }}
            onClick={() => setActiveTab('integrations')}
          >
            <Webhook size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Integration & Webhooks
          </button>
        </div>

        {/* Tab 1: Delivery Account Reviews */}
        {activeTab === 'delivery-accounts' && (
          <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Delivery Personnel Authorization</h3>
                <small className="muted">Approve or reject delivery applicants to enforce backend verification security boundaries.</small>
              </div>
              <button className="button" style={{ minHeight: '32px', fontSize: '.8rem' }} onClick={loadAccounts} disabled={loading}>
                <RefreshCw size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="empty-state" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                <Users size={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No delivery accounts pending review.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {accounts.map(acc => (
                  <div
                    key={acc.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      padding: '14px 18px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--surface-warm)',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <b style={{ fontSize: '.95rem' }}>{acc.user?.name || 'Unnamed Agent'}</b>
                        <span
                          style={{
                            fontSize: '.75rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            background: acc.reviewStatus === 'APPROVED' ? '#e8f5ec' : acc.reviewStatus === 'PENDING' ? '#fef7e6' : '#fff0ed',
                            color: acc.reviewStatus === 'APPROVED' ? '#1a6840' : acc.reviewStatus === 'PENDING' ? '#8a5a00' : '#9f3526',
                          }}
                        >
                          {acc.reviewStatus}
                        </span>
                      </div>
                      <small className="muted" style={{ display: 'block' }}>
                        Phone: {acc.user?.phone || 'None'} · Employer: {acc.employer} · Ref: {acc.deliveryReference}
                      </small>
                      {acc.rejectionReason && (
                        <small style={{ color: '#9f3526', display: 'block', marginTop: '2px' }}>
                          Reason: {acc.rejectionReason}
                        </small>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {acc.reviewStatus !== 'APPROVED' && (
                        <button
                          className="button primary"
                          style={{ fontSize: '.82rem', minHeight: '34px', background: '#1a6840', borderColor: '#1a6840' }}
                          onClick={() => reviewAccount(acc.id, 'APPROVE')}
                        >
                          <UserCheck size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                          Approve
                        </button>
                      )}

                      {acc.reviewStatus !== 'REJECTED' && (
                        <button
                          className="button"
                          style={{ fontSize: '.82rem', minHeight: '34px', color: '#9f3526' }}
                          onClick={() => setRejectingId(rejectingId === acc.id ? null : acc.id)}
                        >
                          <UserX size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                          Reject
                        </button>
                      )}
                    </div>

                    {rejectingId === acc.id && (
                      <div style={{ width: '100%', marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--line)' }}>
                        <input
                          type="text"
                          placeholder="Specify mandatory rejection reason…"
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          style={{ width: '100%', minHeight: '36px', padding: '6px 10px', marginBottom: '8px' }}
                        />
                        <button
                          className="button"
                          style={{ background: '#9f3526', color: 'white', minHeight: '32px', fontSize: '.8rem' }}
                          disabled={!rejectReason.trim()}
                          onClick={() => reviewAccount(acc.id, 'REJECT', rejectReason.trim())}
                        >
                          Confirm Rejection
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Payout Batches & Ledger */}
        {activeTab === 'payouts' && (
          <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', maxWidth: '720px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>Weekly Payout Scheduler</h3>
            <p className="muted" style={{ fontSize: '.86rem', marginTop: 0 }}>
              Trigger or review idempotent weekly batch payouts. Deliveries verified by Sunday 23:59:59 IST qualify for the scheduled Monday 10:00 AM IST payout run.
            </p>

            <div style={{ background: 'var(--surface-warm)', padding: '16px', borderRadius: '6px', border: '1px solid var(--line)', margin: '16px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <b>Current Payout Cadence:</b> Weekly on Mondays
                  <small className="muted" style={{ display: 'block' }}>Eligibility: Customer verified OTP delivery with seller ₹5 reward funding reservation.</small>
                </div>
                <button
                  className="button primary"
                  style={{ minHeight: '38px', fontSize: '.85rem' }}
                  disabled={runningPayout}
                  onClick={triggerPayoutBatch}
                >
                  <Play size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                  {runningPayout ? 'Scheduling…' : 'Schedule Payout Batch'}
                </button>
              </div>
            </div>

            {payoutResult && (
              <div style={{ background: '#e8f5ec', padding: '12px 14px', borderRadius: '4px', border: '1px solid #1a6840', fontSize: '.85rem' }}>
                <b style={{ color: '#1a6840' }}>Batch Output:</b>
                <p style={{ margin: '4px 0' }}>{payoutResult.note}</p>
                <small className="muted">Scheduled For: {new Date(payoutResult.scheduledFor).toLocaleString()}</small>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Integrations & Webhooks */}
        {activeTab === 'integrations' && (
          <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
              <div className="eyebrow" style={{ color: 'var(--muted)' }}>COURIER TRACKING</div>
              <h3 style={{ margin: '6px 0 10px', fontSize: '1.1rem' }}>AfterShip Webhook Adapter</h3>
              <p className="muted" style={{ fontSize: '.85rem' }}>
                Receives external courier status changes (e.g. Blue Dart, Delhivery) and matches events with order shipment records.
              </p>
              <div style={{ padding: '8px 12px', background: 'var(--background)', borderRadius: '4px', fontSize: '.82rem', fontFamily: 'monospace' }}>
                Endpoint: POST /api/integrations/aftership/webhook
              </div>
              <small className="muted" style={{ display: 'block', marginTop: '8px' }}>
                Status: Listening · Idempotent event deduplication active.
              </small>
            </div>

            <div className="panel" style={{ padding: '20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px' }}>
              <div className="eyebrow" style={{ color: 'var(--muted)' }}>PAYMENT GATEWAY</div>
              <h3 style={{ margin: '6px 0 10px', fontSize: '1.1rem' }}>Razorpay Funding Sandbox</h3>
              <p className="muted" style={{ fontSize: '.85rem' }}>
                Facilitates seller reward funding transactions (₹5 + ₹1 fee allowance per parcel reservation) and sandbox verification.
              </p>
              <div style={{ padding: '8px 12px', background: 'var(--background)', borderRadius: '4px', fontSize: '.82rem', fontFamily: 'monospace' }}>
                Endpoint: POST /api/seller/funding/capture
              </div>
              <small className="muted" style={{ display: 'block', marginTop: '8px' }}>
                Status: Sandbox Sandbox Verified · No real banking transfers in MVP demo.
              </small>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
