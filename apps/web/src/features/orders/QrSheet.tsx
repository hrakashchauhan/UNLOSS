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
  async function copy() { try { await navigator.clipboard.writeText(absolute!); setFeedback('Link copied.'); } catch { setFeedback('Copy failed. Select and copy the link below.'); } }
  const label = purpose === 'delivery' ? 'Delivery QR' : 'Customer QR';
  return <section className="token-card"><h2>{label}</h2>{absolute ? <>
    <QRCodeSVG value={absolute} size={220} level="M" marginSize={4} title={`${label} purpose-specific order link`} role="img" />
    <p>{purpose === 'delivery' ? 'For the authorized delivery partner: record the attempt and permitted outcome.' : 'For the recipient: verify with OTP, then accept, reject, or request redelivery when permitted.'}</p>
    <a href={absolute} target="_blank" rel="noreferrer">{absolute}</a><button className="button subtle" onClick={copy}>Copy {purpose} link</button><span role="status">{feedback}</span>
  </> : <ErrorBox message="The server returned an invalid purpose-specific QR link. Contact the seller; this link cannot be printed as a QR code." />}</section>;
}
export function QrSheet({ result }: { result: OrderCreated }) {
  const { order, qr } = result;
  return <article className="qr-sheet"><div className="page-heading"><div><div className="eyebrow">UNLOSS · ORDER CREATED</div><h1>Order {order.sellerReference || order.id.slice(-8)}</h1><Status status={order.status} /></div></div>
    <p className="notice no-print" role="status">Order saved. Print or save this sheet now. For privacy, these links are not stored in this browser or available again from the order details.</p>
    <p>Recipient: <b>{order.customer.name}</b><br />{order.deliveryAddress.line1}{order.deliveryAddress.line2 && <>, {order.deliveryAddress.line2}</>}<br />{order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.postalCode}</p>
    <div className="token-grid"><TokenCard purpose="delivery" url={qr.deliveryUrl} /><TokenCard purpose="customer" url={qr.customerUrl} /></div>
    <p className="public-copy">A scan opens a workflow; it does not prove physical delivery. Keep the customer code available to the recipient. Do not publish these private action links.</p>
    <div className="form-actions no-print"><button className="button primary" onClick={() => window.print()}>Print QR sheet</button><Link className="button subtle" to={`/orders/${encodeURIComponent(order.id)}`}>Open order</Link><Link className="button subtle" to="/orders">Back to orders</Link></div>
  </article>;
}
