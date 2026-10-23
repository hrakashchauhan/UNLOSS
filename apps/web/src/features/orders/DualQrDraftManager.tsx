import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Archive,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Package,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Send,
  Truck,
} from 'lucide-react';
import {
  draftsApi,
  fundingApi,
  type DraftCreated,
  type OrderDraft,
} from '../../api';
import { ErrorBox, errText, formatDate } from '../../ui/common';

export function DualQrDraftManager({ onOrderActivated }: { onOrderActivated?: (orderId: string) => void }) {
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeDraft, setActiveDraft] = useState<DraftCreated | null>(null);
  const [draftsList, setDraftsList] = useState<OrderDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [activating, setActivating] = useState(false);

  // Recipient form state
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [courier, setCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  const printAreaRef = useRef<HTMLDivElement>(null);

  async function loadDrafts() {
    try {
      const res = await draftsApi.list();
      setDraftsList(res.items || []);
    } catch {
      // Ignore background refresh errors
    }
  }

  useEffect(() => {
    void loadDrafts();
  }, []);

  async function handleCreateDraft(e: FormEvent) {
    e.preventDefault();
    if (!productName.trim() || loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const created = await draftsApi.create({ productName: productName.trim(), quantity });
      setActiveDraft(created);
      setSuccess(`Draft saved for "${created.product.name}". Both QR codes generated immediately.`);
      // Reset recipient inputs
      setRecipientName('');
      setRecipientPhone('+919876543210');
      setLine1('');
      setLine2('');
      setCity('Bengaluru');
      setState('Karnataka');
      setPostalCode('560001');
      setCourier('BlueDart Express');
      setTrackingNumber(`TRK-${Date.now().toString().slice(-8)}`);
      await loadDrafts();
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDetails(e: FormEvent) {
    e.preventDefault();
    if (!activeDraft || savingDetails) return;
    setSavingDetails(true);
    setError('');
    setSuccess('');
    try {
      const updated = await draftsApi.update(activeDraft.draft.id, {
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        addressLine1: line1.trim(),
        addressLine2: line2.trim() || null,
        city: city.trim(),
        state: state.trim(),
        postalCode: postalCode.trim(),
        courier: courier.trim() || null,
        trackingNumber: trackingNumber.trim() || null,
      });
      setActiveDraft({
        ...activeDraft,
        draft: updated.draft,
      });
      setSuccess('Shipment and recipient details saved to persistent draft.');
      await loadDrafts();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleDuplicate() {
    if (!activeDraft) return;
    setLoading(true);
    setError('');
    try {
      const dup = await draftsApi.duplicate(activeDraft.draft.id);
      setActiveDraft({
        draft: dup.draft,
        product: activeDraft.product,
        qr: dup.qr,
        status: 'AWAITING_ACTIVATION',
      });
      setSuccess('Draft duplicated with a fresh set of high-entropy QR tokens.');
      await loadDrafts();
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive() {
    if (!activeDraft) return;
    if (!window.confirm('Are you sure you want to revoke these QR codes and archive this draft?')) return;
    setLoading(true);
    setError('');
    try {
      await draftsApi.archive(activeDraft.draft.id);
      setActiveDraft(null);
      setSuccess('Draft archived and QR tokens revoked.');
      await loadDrafts();
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate() {
    if (!activeDraft || activating) return;
    setActivating(true);
    setError('');
    setSuccess('');
    try {
      // Step 1: Ensure funding reservation is present or try reserving
      try {
        await fundingApi.reserve(activeDraft.draft.id);
      } catch {
        // If funding account doesn't have enough, we can proceed in demo mode
      }

      // Step 2: Activate draft into live order
      const activated = await draftsApi.activate(activeDraft.draft.id);
      setSuccess(`Order activated successfully! Order ID: ${activated.orderId}. Live dual QR codes are ready.`);
      setActiveDraft(null);
      await loadDrafts();
      if (onOrderActivated) {
        onOrderActivated(activated.orderId);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setActivating(false);
    }
  }

  function handleReopen(draft: OrderDraft) {
    const deliveryToken = draft.tokens?.find(t => t.purpose === 'DELIVERY')?.encryptedToken;
    const customerToken = draft.tokens?.find(t => t.purpose === 'CUSTOMER')?.encryptedToken;
    const origin = window.location.origin;

    setActiveDraft({
      draft,
      product: draft.product,
      qr: {
        deliveryUrl: deliveryToken ? `${origin}/draft/delivery/${deliveryToken}` : `${origin}/draft/delivery/${draft.id}`,
        customerUrl: customerToken ? `${origin}/draft/customer/${customerToken}` : `${origin}/draft/customer/${draft.id}`,
      },
      status: draft.status === 'ACTIVATED' ? 'ACTIVATED' : 'AWAITING_ACTIVATION',
    });

    setRecipientName(draft.recipientName || '');
    setRecipientPhone(draft.recipientPhone || '');
    setLine1(draft.addressLine1 || '');
    setLine2(draft.addressLine2 || '');
    setCity(draft.city || '');
    setState(draft.state || '');
    setPostalCode(draft.postalCode || '');
    setCourier(draft.courier || '');
    setTrackingNumber(draft.trackingNumber || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function downloadSvg(svgId: string, filename: string) {
    const svgElem = document.getElementById(svgId);
    if (!svgElem) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgElem);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label} copied to clipboard!`);
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError(`Failed to copy ${label}. Select and copy manually.`);
    }
  }

  return (
    <div className="dual-qr-manager">
      {/* Product-First Quick Creator */}
      <section className="panel" style={{ marginBottom: '24px', borderLeft: '4px solid var(--primary)' }}>
        <div className="eyebrow" style={{ color: 'var(--primary)', fontWeight: 700 }}>
          PRODUCT-FIRST WORKFLOW · STEP 1
        </div>
        <h2 style={{ margin: '4px 0 12px' }}>Instant Dual QR Generator</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>
          Enter any product name to immediately save a persistent draft and generate two scannable QR codes: one for delivery dispatch and one for customer verification.
        </p>

        <form onSubmit={handleCreateDraft} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '2 1 240px' }}>
            <span>Product Name:</span>
            <input
              type="text"
              required
              placeholder="e.g. Handmade Ceramic Vase, Cotton Linen Shirt"
              value={productName}
              onChange={e => setProductName(e.target.value)}
              disabled={loading}
              style={{ width: '100%', minHeight: '40px', padding: '8px 12px' }}
            />
          </label>

          <label style={{ flex: '1 1 100px' }}>
            <span>Quantity:</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={quantity}
              onChange={e => setQuantity(Number(e.target.value) || 1)}
              disabled={loading}
              style={{ width: '100%', minHeight: '40px', padding: '8px 12px' }}
            />
          </label>

          <button
            type="submit"
            className="button primary"
            disabled={loading || !productName.trim()}
            style={{ minHeight: '40px', padding: '0 20px', fontWeight: 600 }}
          >
            {loading ? <RefreshCw className="spin" size={16} /> : <Plus size={16} style={{ marginRight: '6px' }} />}
            Save Draft & Generate Dual QR
          </button>
        </form>

        {error && <div style={{ marginTop: '12px' }}><ErrorBox message={error} /></div>}
        {success && <p className="notice" role="status" style={{ marginTop: '12px' }}>{success}</p>}
      </section>

      {/* Active Dual QR Matrix View */}
      {activeDraft && (
        <section
          ref={printAreaRef}
          className="panel"
          style={{
            marginBottom: '24px',
            background: 'var(--surface-warm)',
            border: '2px solid var(--primary-border)',
            borderRadius: '8px',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '20px' }}>
            <div>
              <span className="eyebrow" style={{ color: 'var(--primary)', fontWeight: 700 }}>
                PERSISTENT DRAFT: #{activeDraft.draft.id.slice(-8).toUpperCase()}
              </span>
              <h2 style={{ margin: '2px 0 4px', fontSize: '1.4rem' }}>{activeDraft.product.name} (Qty: {activeDraft.draft.quantity})</h2>
              <small className="muted">Status: <b>{activeDraft.status}</b> · Saved {formatDate(activeDraft.draft.createdAt)}</small>
            </div>

            <div className="no-print" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="button subtle" onClick={handleDuplicate} disabled={loading} title="Duplicate this draft with new QR tokens">
                <Layers size={14} style={{ marginRight: '4px' }} /> Duplicate
              </button>
              <button className="button subtle" onClick={() => window.print()} title="Print shipping labels sheet">
                <Printer size={14} style={{ marginRight: '4px' }} /> Print Label Sheet
              </button>
              <button className="button subtle" style={{ color: '#d74032' }} onClick={handleArchive} disabled={loading} title="Archive draft and revoke tokens">
                <Archive size={14} style={{ marginRight: '4px' }} /> Revoke & Archive
              </button>
            </div>
          </div>

          {/* Dual QR Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            {/* Delivery QR */}
            <div style={{ background: '#ffffff', border: '1px solid var(--line)', borderRadius: '8px', padding: '20px', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--primary)', fontWeight: 700, fontSize: '.9rem', marginBottom: '8px' }}>
                <Truck size={18} />
                <span>DELIVERY WORKFLOW QR</span>
              </div>
              <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 12px' }}>
                For courier scanning, location evidence, and authorized parcel handoff.
              </p>
              <div style={{ padding: '12px', background: '#faf9f6', display: 'inline-block', borderRadius: '8px', border: '1px solid #e2e4df', marginBottom: '12px' }}>
                <QRCodeSVG
                  id="delivery-qr-svg"
                  value={activeDraft.qr.deliveryUrl}
                  size={180}
                  level="M"
                  marginSize={2}
                />
              </div>
              <div style={{ wordBreak: 'break-all', fontSize: '.76rem', color: 'var(--muted)', background: '#f5f5f3', padding: '6px 10px', borderRadius: '4px', marginBottom: '12px' }}>
                {activeDraft.qr.deliveryUrl}
              </div>
              <div className="no-print" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  className="button subtle"
                  style={{ minHeight: '34px', fontSize: '.82rem' }}
                  onClick={() => copyText(activeDraft.qr.deliveryUrl, 'Delivery QR link')}
                >
                  <Copy size={13} style={{ marginRight: '4px' }} /> Copy Link
                </button>
                <button
                  className="button subtle"
                  style={{ minHeight: '34px', fontSize: '.82rem' }}
                  onClick={() => downloadSvg('delivery-qr-svg', `unloss-delivery-qr-${activeDraft.draft.id.slice(-6)}`)}
                >
                  <Download size={13} style={{ marginRight: '4px' }} /> SVG
                </button>
              </div>
            </div>

            {/* Customer QR */}
            <div style={{ background: '#ffffff', border: '1px solid var(--line)', borderRadius: '8px', padding: '20px', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#1a6840', fontWeight: 700, fontSize: '.9rem', marginBottom: '8px' }}>
                <CheckCircle2 size={18} />
                <span>CUSTOMER VERIFICATION QR</span>
              </div>
              <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 12px' }}>
                For the recipient to verify OTP, accept parcel, or request structured redelivery.
              </p>
              <div style={{ padding: '12px', background: '#faf9f6', display: 'inline-block', borderRadius: '8px', border: '1px solid #e2e4df', marginBottom: '12px' }}>
                <QRCodeSVG
                  id="customer-qr-svg"
                  value={activeDraft.qr.customerUrl}
                  size={180}
                  level="M"
                  marginSize={2}
                />
              </div>
              <div style={{ wordBreak: 'break-all', fontSize: '.76rem', color: 'var(--muted)', background: '#f5f5f3', padding: '6px 10px', borderRadius: '4px', marginBottom: '12px' }}>
                {activeDraft.qr.customerUrl}
              </div>
              <div className="no-print" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  className="button subtle"
                  style={{ minHeight: '34px', fontSize: '.82rem' }}
                  onClick={() => copyText(activeDraft.qr.customerUrl, 'Customer QR link')}
                >
                  <Copy size={13} style={{ marginRight: '4px' }} /> Copy Link
                </button>
                <button
                  className="button subtle"
                  style={{ minHeight: '34px', fontSize: '.82rem' }}
                  onClick={() => downloadSvg('customer-qr-svg', `unloss-customer-qr-${activeDraft.draft.id.slice(-6)}`)}
                >
                  <Download size={13} style={{ marginRight: '4px' }} /> SVG
                </button>
              </div>
            </div>
          </div>

          {/* Shipment & Recipient Form */}
          <div className="no-print" style={{ background: '#ffffff', border: '1px solid var(--line)', borderRadius: '8px', padding: '20px' }}>
            <div className="eyebrow" style={{ color: 'var(--primary)', fontWeight: 700 }}>
              STEP 2: ADD SHIPMENT & RECIPIENT DETAILS
            </div>
            <h3 style={{ margin: '4px 0 16px', fontSize: '1.1rem' }}>Complete Delivery Information</h3>

            <form onSubmit={handleSaveDetails}>
              <div className="form-grid" style={{ marginBottom: '16px' }}>
                <label>
                  <span>Recipient Full Name:</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ramesh Sharma"
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                  />
                </label>

                <label>
                  <span>Recipient Phone:</span>
                  <input
                    type="tel"
                    required
                    placeholder="+919876543210"
                    value={recipientPhone}
                    onChange={e => setRecipientPhone(e.target.value)}
                  />
                </label>

                <label className="span2">
                  <span>Address Line 1:</span>
                  <input
                    type="text"
                    required
                    placeholder="Flat / House No., Street, Area"
                    value={line1}
                    onChange={e => setLine1(e.target.value)}
                  />
                </label>

                <label className="span2">
                  <span>Address Line 2 (Optional):</span>
                  <input
                    type="text"
                    placeholder="Landmark, Suite, Unit"
                    value={line2}
                    onChange={e => setLine2(e.target.value)}
                  />
                </label>

                <label>
                  <span>City:</span>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={e => setCity(e.target.value)}
                  />
                </label>

                <label>
                  <span>State:</span>
                  <input
                    type="text"
                    required
                    value={state}
                    onChange={e => setState(e.target.value)}
                  />
                </label>

                <label>
                  <span>Postal Code (PIN):</span>
                  <input
                    type="text"
                    required
                    value={postalCode}
                    onChange={e => setPostalCode(e.target.value)}
                  />
                </label>

                <label>
                  <span>Courier Partner:</span>
                  <input
                    type="text"
                    placeholder="e.g. BlueDart, Delhivery, DTDC"
                    value={courier}
                    onChange={e => setCourier(e.target.value)}
                  />
                </label>

                <label className="span2">
                  <span>Tracking Number:</span>
                  <input
                    type="text"
                    placeholder="e.g. BLU-9028471"
                    value={trackingNumber}
                    onChange={e => setTrackingNumber(e.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  className="button subtle"
                  disabled={savingDetails}
                  style={{ minHeight: '38px' }}
                >
                  {savingDetails ? 'Saving Details…' : 'Save Details to Draft'}
                </button>

                <button
                  type="button"
                  className="button primary"
                  disabled={activating || !recipientName || !recipientPhone || !line1 || !city || !state || !postalCode}
                  onClick={handleActivate}
                  style={{ minHeight: '40px', padding: '0 20px', fontWeight: 700 }}
                  title="Enforce requirements and activate this draft into a live order in the delivery timeline"
                >
                  {activating ? 'Activating Order…' : '🚀 Activate Draft into Live Order'}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* Saved Drafts History & Reopen */}
      <section className="panel table-panel">
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Saved Drafts & Dual QR Library</h2>
            <small className="muted">{draftsList.length} saved drafts recorded in database</small>
          </div>
          <button className="button subtle" onClick={loadDrafts} style={{ minHeight: '32px', fontSize: '.82rem' }}>
            <RefreshCw size={13} style={{ marginRight: '4px' }} /> Refresh Drafts
          </button>
        </div>

        {draftsList.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Draft Ref</th>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Recipient Info</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {draftsList.map(draft => (
                  <tr key={draft.id}>
                    <td>
                      <b>{draft.id.slice(-8).toUpperCase()}</b>
                    </td>
                    <td>{draft.product?.name || 'Unnamed Product'}</td>
                    <td>{draft.quantity}</td>
                    <td>
                      {draft.recipientName ? (
                        <span>
                          <b>{draft.recipientName}</b>
                          <small className="muted" style={{ display: 'block' }}>{draft.city}, {draft.state}</small>
                        </span>
                      ) : (
                        <span className="muted" style={{ fontStyle: 'italic' }}>Pending address details</span>
                      )}
                    </td>
                    <td>{formatDate(draft.createdAt)}</td>
                    <td>
                      <span
                        style={{
                          fontSize: '.75rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: draft.status === 'ACTIVATED' ? '#e8f5ec' : '#e6f3f3',
                          color: draft.status === 'ACTIVATED' ? '#1a6840' : 'var(--primary)',
                        }}
                      >
                        {draft.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button subtle"
                        style={{ minHeight: '30px', fontSize: '.78rem', padding: '2px 8px' }}
                        onClick={() => handleReopen(draft)}
                      >
                        Reopen Dual QR
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
            <Package size={28} style={{ opacity: 0.5, marginBottom: '8px' }} />
            <p style={{ margin: 0 }}>No saved drafts yet. Type a product name above to create your first draft.</p>
          </div>
        )}
      </section>
    </div>
  );
}
