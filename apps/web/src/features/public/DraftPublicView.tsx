import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, Clock, Package, ShieldCheck, Truck, XCircle } from 'lucide-react';
import { API_BASE } from '../../api';

interface DraftPublicData {
  status: 'AWAITING_ACTIVATION' | 'ACTIVATED';
  purpose: 'DELIVERY' | 'CUSTOMER';
  productName: string;
  quantity: number;
  hasRecipient: boolean;
  orderId?: string;
  redirectUrl?: string;
}

export function DraftPublicView({ kind }: { kind: 'delivery' | 'customer' }) {
  const { token = '' } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DraftPublicData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function fetchDraftInfo() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/drafts/public/${encodeURIComponent(token)}`);
        if (!res.ok) {
          throw new Error('This QR code is invalid, revoked, or has expired.');
        }
        const json = await res.json();
        if (active) {
          setData(json);
          // If already activated, redirect if link available
          if (json.status === 'ACTIVATED' && json.redirectUrl) {
            window.location.replace(json.redirectUrl);
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'QR token lookup failed.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchDraftInfo();
    return () => { active = false; };
  }, [token]);

  return (
    <main className="login-screen" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="login-card" style={{ maxWidth: '480px', width: '100%', background: '#fff', border: '1px solid var(--line)', borderRadius: '8px', padding: '28px' }}>
        <div className="brand login-brand" style={{ marginBottom: '16px' }}>
          <div className="brand-mark">u</div>
          <span>unloss<span className="brand-dot">.</span></span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--muted)' }}>
            <Clock size={36} className="spin" style={{ margin: '0 auto 12px', opacity: 0.6 }} />
            <p>Verifying QR security token…</p>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <XCircle size={44} style={{ color: '#d74032', margin: '0 auto 12px' }} />
            <h2 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>Invalid or Expired QR Code</h2>
            <p className="muted" style={{ fontSize: '.9rem', margin: '0 0 20px' }}>{error}</p>
            <Link to="/login" className="button subtle">Go to UNLOSS Home</Link>
          </div>
        ) : data ? (
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e6f3f3', color: 'var(--primary)', padding: '4px 10px', borderRadius: '4px', fontWeight: 700, fontSize: '.8rem', marginBottom: '12px' }}>
              <ShieldCheck size={14} />
              <span>PRE-DISPATCH PARCEL VERIFICATION</span>
            </div>

            <h1 style={{ fontSize: '1.4rem', margin: '4px 0 8px' }}>
              {data.productName}
            </h1>
            <p className="muted" style={{ fontSize: '.88rem', margin: '0 0 18px' }}>
              Quantity: <b>{data.quantity} unit(s)</b> · Token Purpose: <b>{data.purpose}</b>
            </p>

            <div style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <Clock size={20} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <b style={{ display: 'block', fontSize: '.92rem', marginBottom: '4px' }}>
                    Status: Awaiting Dispatch & Activation
                  </b>
                  <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {data.purpose === 'DELIVERY'
                      ? 'This is an authorized Delivery Workflow QR. It will become eligible for carrier scanning once the seller marks the package Out for Delivery.'
                      : 'This is an authorized Customer Verification QR. It will become active for OTP confirmation when the courier arrives at your delivery address.'}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px', fontSize: '.82rem', color: 'var(--muted)' }}>
              <b>Security Boundary Notice:</b> A QR scan is an accountability trigger, not proof of physical delivery. All status changes are cryptographically bound and validated server-side.
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
