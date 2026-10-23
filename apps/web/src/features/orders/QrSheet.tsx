import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { OrderCreated } from '../../api';
import { ErrorBox, Status } from '../../ui/common';

export function safeQrUrl(value: string, purpose: 'delivery' | 'customer') {
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !new RegExp(`^/(draft/)?${purpose}/[^/]+$`).test(url.pathname) || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function TokenCard({ purpose, url }: { purpose: 'delivery' | 'customer'; url: string }) {
  const [feedback, setFeedback] = useState('');
  const absolute = safeQrUrl(url, purpose);
  async function copy() {
    try {
      await navigator.clipboard.writeText(absolute!);
      setFeedback('Link copied.');
    } catch {
      setFeedback('Copy failed. Select and copy the link below.');
    }
  }

  const label = purpose === 'delivery' ? 'Delivery QR' : 'Customer QR';
  const printLabel = purpose === 'delivery' ? 'DELIVERY' : 'CUSTOMER';

  return (
    <section className="token-card clean-qr-card">
      <div className="print-label-only">{printLabel}</div>
      <h2 className="screen-heading-only">{label}</h2>
      {absolute ? (
        <>
          <div className="clean-qr-canvas">
            <QRCodeSVG
              value={absolute}
              size={220}
              level="M"
              marginSize={2}
              title={`${label} purpose-specific order link`}
              role="img"
            />
          </div>
          <div className="no-print">
            <a
              href={absolute}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '11px', wordBreak: 'break-all', display: 'block', margin: '8px 0', color: '#047857' }}
            >
              {absolute}
            </a>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="button subtle" onClick={copy}>
                Copy {purpose} link
              </button>
              <span role="status" style={{ fontSize: '11px', color: '#047857' }}>
                {feedback}
              </span>
            </div>
          </div>
        </>
      ) : (
        <ErrorBox message="The server returned an invalid purpose-specific QR link." />
      )}
    </section>
  );
}

export function QrSheet({ result }: { result: OrderCreated }) {
  const { order, qr } = result;

  return (
    <article className="qr-sheet qr-sheet-wrapper">
      <div className="page-heading no-print">
        <div>
          <div className="eyebrow">UNLOSS · ORDER CREATED</div>
          <h1>Order {order.sellerReference || order.id.slice(-8)}</h1>
          <Status status={order.status} />
        </div>
      </div>
      <p className="notice no-print" role="status">
        Order saved. Print or save this sheet now.
      </p>
      <div className="no-print" style={{ margin: '14px 0' }}>
        <p>
          Recipient: <b>{order.customer.name}</b>
          <br />
          {order.deliveryAddress.line1}
          {order.deliveryAddress.line2 && <>, {order.deliveryAddress.line2}</>}
          <br />
          {order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.postalCode}
        </p>
      </div>

      <div className="token-grid clean-qr-grid">
        <TokenCard purpose="delivery" url={qr.deliveryUrl} />
        <TokenCard purpose="customer" url={qr.customerUrl} />
      </div>

      <div className="form-actions no-print">
        <button className="button primary" onClick={() => window.print()}>
          Print QR sheet
        </button>
        <Link className="button subtle" to={`/orders/${encodeURIComponent(order.id)}`}>
          Open order
        </Link>
        <Link className="button subtle" to="/orders">
          Back to orders
        </Link>
      </div>
    </article>
  );
}
