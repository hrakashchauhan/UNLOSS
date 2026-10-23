import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, Eye, ArrowLeft, ExternalLink, Copy, Check } from 'lucide-react';
import type { OrderCreated } from '../../api';
import { ErrorBox, Status } from '../../ui/common';

export function safeQrUrl(value: string, purpose: 'delivery' | 'customer') {
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !new RegExp(`^/(draft/)?${purpose}/[^/]+$`).test(url.pathname) || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function QrSheet({ result }: { result: OrderCreated }) {
  const { order, qr } = result;
  const [copiedRole, setCopiedRole] = useState<'delivery' | 'customer' | null>(null);
  const [minimalPreview, setMinimalPreview] = useState(false);

  const deliveryAbsolute = safeQrUrl(qr.deliveryUrl, 'delivery');
  const customerAbsolute = safeQrUrl(qr.customerUrl, 'customer');

  async function copyUrl(url: string | null, role: 'delivery' | 'customer') {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRole(role);
      setTimeout(() => setCopiedRole(null), 2000);
    } catch {
      // Fallback
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <article className="qr-sheet-wrapper">
      {/* =========================================================================
          PRINT ONLY AREA: Exactly as requested:
          "The QR sheet needs to print the QR only, no text, nothing with it but it
          needs to be easily visible whether it is for the delivery guy or customer.
          It needs to be written there and nothing else."
          ========================================================================= */}
      <div className="qr-print-only-sheet" id="printable-qr-sheet">
        {deliveryAbsolute && (
          <div className="qr-print-ticket">
            <div className="qr-print-label">DELIVERY</div>
            <div className="qr-print-code">
              <QRCodeSVG
                value={deliveryAbsolute}
                size={280}
                level="M"
                marginSize={1}
                role="img"
                aria-label="Delivery QR"
              />
            </div>
          </div>
        )}

        {customerAbsolute && (
          <div className="qr-print-ticket">
            <div className="qr-print-label">CUSTOMER</div>
            <div className="qr-print-code">
              <QRCodeSVG
                value={customerAbsolute}
                size={280}
                level="M"
                marginSize={1}
                role="img"
                aria-label="Customer QR"
              />
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          ON-SCREEN WEB INTERFACE
          ========================================================================= */}
      <div className="no-print">
        {/* Navigation & Toolbar */}
        <div className="qr-sheet-toolbar">
          <Link to="/orders" className="button subtle" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} /> Back to orders
          </Link>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className={`button ${minimalPreview ? 'active-toggle' : 'subtle'}`}
              onClick={() => setMinimalPreview(!minimalPreview)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Eye size={16} /> {minimalPreview ? 'Show Order Info' : 'Print Preview Mode'}
            </button>
            <button
              type="button"
              className="button primary"
              onClick={handlePrint}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
            >
              <Printer size={16} /> Print Clean QR Sheet
            </button>
          </div>
        </div>

        {/* Header banner */}
        {!minimalPreview && (
          <div className="qr-sheet-header">
            <div>
              <span className="eyebrow" style={{ color: '#047857', fontWeight: 700 }}>VERIFIED PARCEL TOKENS</span>
              <h1 style={{ margin: '4px 0 6px', fontSize: '24px', letterSpacing: '-0.5px' }}>
                Order #{order.sellerReference || order.id.slice(-8).toUpperCase()}
              </h1>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Status status={order.status} />
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Recipient: <b>{order.customer.name}</b> ({order.deliveryAddress.city}, {order.deliveryAddress.state})
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Clean On-Screen Cards */}
        <div className="clean-qr-grid">
          {/* DELIVERY CARD */}
          <div className="clean-qr-card">
            <div className="clean-qr-badge delivery-badge">DELIVERY</div>
            <div className="clean-qr-canvas">
              {deliveryAbsolute ? (
                <QRCodeSVG
                  value={deliveryAbsolute}
                  size={240}
                  level="M"
                  marginSize={2}
                  role="img"
                  aria-label="Delivery QR"
                />
              ) : (
                <ErrorBox message="Invalid delivery token URL" />
              )}
            </div>
            {!minimalPreview && deliveryAbsolute && (
              <div className="clean-qr-actions">
                <a
                  href={deliveryAbsolute}
                  target="_blank"
                  rel="noreferrer"
                  className="button subtle"
                  style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                >
                  <ExternalLink size={13} style={{ marginRight: '4px' }} /> Open Link
                </a>
                <button
                  type="button"
                  className="button subtle"
                  style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                  onClick={() => copyUrl(deliveryAbsolute, 'delivery')}
                >
                  {copiedRole === 'delivery' ? (
                    <><Check size={13} style={{ marginRight: '4px', color: '#059669' }} /> Copied</>
                  ) : (
                    <><Copy size={13} style={{ marginRight: '4px' }} /> Copy Link</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* CUSTOMER CARD */}
          <div className="clean-qr-card">
            <div className="clean-qr-badge customer-badge">CUSTOMER</div>
            <div className="clean-qr-canvas">
              {customerAbsolute ? (
                <QRCodeSVG
                  value={customerAbsolute}
                  size={240}
                  level="M"
                  marginSize={2}
                  role="img"
                  aria-label="Customer QR"
                />
              ) : (
                <ErrorBox message="Invalid customer token URL" />
              )}
            </div>
            {!minimalPreview && customerAbsolute && (
              <div className="clean-qr-actions">
                <a
                  href={customerAbsolute}
                  target="_blank"
                  rel="noreferrer"
                  className="button subtle"
                  style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                >
                  <ExternalLink size={13} style={{ marginRight: '4px' }} /> Open Link
                </a>
                <button
                  type="button"
                  className="button subtle"
                  style={{ flex: 1, fontSize: '11px', justifyContent: 'center' }}
                  onClick={() => copyUrl(customerAbsolute, 'customer')}
                >
                  {copiedRole === 'customer' ? (
                    <><Check size={13} style={{ marginRight: '4px', color: '#059669' }} /> Copied</>
                  ) : (
                    <><Copy size={13} style={{ marginRight: '4px' }} /> Copy Link</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Tip: Pressing <b>Print Clean QR Sheet</b> will output only the QRs labeled DELIVERY and CUSTOMER.
          </span>
          <Link to={`/orders/${encodeURIComponent(order.id)}`} className="button subtle">
            View full order details &rarr;
          </Link>
        </div>
      </div>
    </article>
  );
}
