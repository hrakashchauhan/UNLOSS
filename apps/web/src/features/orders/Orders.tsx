import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, Printer, Search } from 'lucide-react';
import { ordersApi, type CreateOrderRequest, type Order, type OrderCreated, type OrderStatus, type ReasonCode, type Event } from '../../api';
import { statuses, reasons, sellerSteps } from '../../domain';
import { BackLink, Empty, ErrorBox, PageHead, Pagination, Status, errText, formatDate, pretty } from '../../ui/common';
import { ResourceState } from '../../ui/ResourceState';
import { useResource } from '../../ui/useResource';
import { ParcelPanel } from '../parcels/ParcelWorkspace';
import { QrSheet } from './QrSheet';
import { DualQrDraftManager } from './DualQrDraftManager';

export function OrdersPage({ id, returns = false }: { id?: string; returns?: boolean }) {
  if (id === 'new') return <CreateOrder />;
  if (id) return <OrderDetail key={id} id={id} />;
  return <OrdersList key={String(returns)} returns={returns} />;
}

export function OrdersTable({ orders, filtered = false }: { orders: Order[]; filtered?: boolean }) {
  if (!orders.length) return <Empty icon={<Box size={22} />} title={filtered ? 'No matching orders' : 'No orders yet'} text={filtered ? 'Try another reference, customer name, or status.' : 'Create an order to start its delivery record.'} action={!filtered && <Link className="button subtle" to="/orders/new">Create your first order</Link>} />;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Order results"><table><caption className="sr-only">Orders and current confirmed status</caption><thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Created</th><th scope="col">Confirmed status</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><Link className="order-link" to={'/orders/' + encodeURIComponent(order.id)}>{order.sellerReference || order.id.slice(-8)}</Link></td><td><b>{order.customer.name}</b><small>{order.customer.phone}</small></td><td>{formatDate(order.createdAt)}</td><td><Status status={order.status} /></td></tr>)}</tbody></table></div>;
}

function OrdersList({ returns }: { returns: boolean }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const requestedStatus = params.get('status') as OrderStatus | null;
  const status = requestedStatus && statuses.includes(requestedStatus) ? requestedStatus : returns ? 'RETURN_INITIATED' : '';
  const requestedPage = Number(params.get('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const choices = returns ? statuses.filter(s => /RETURN|REDELIVERY|REJECTED|FAILED/.test(s)) : statuses;
  const load = useCallback((signal: AbortSignal) => ordersApi.list({ q, status, page, pageSize: 25 }, signal), [q, status, page]);
  const resource = useResource(`${q}/${status}/${page}`, load);
  function update(values: Record<string, string>) { setParams({ q, status, page: '1', ...values }); }
  return <><div className="page-heading"><PageHead eyebrow="DELIVERY OPERATIONS" title={returns ? 'Returns & redelivery' : 'Orders'} text={returns ? 'Inspect reported reasons, arrange the next step, and follow the return record.' : 'Search saved orders and inspect their last confirmed status.'} /><Link className="button primary" to="/orders/new">Create an order</Link></div>
    <section className="panel table-panel"><form className="filter-bar" onSubmit={event => { event.preventDefault(); update({ q: draft.trim() }); }}>
      <label className="search-box"><Search size={17} /><span className="sr-only">Search orders</span><input value={draft} maxLength={160} onChange={event => setDraft(event.target.value)} placeholder="Customer name or reference" /></label>
      <button className="button subtle">Search</button><select aria-label="Filter orders by status" value={status} onChange={event => update({ status: event.target.value })}>{!returns && <option value="">All statuses</option>}{choices.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</select>
      <button type="button" className="button subtle" disabled={resource.loading} onClick={resource.reload}>Refresh</button>
    </form><ResourceState {...resource} retry={resource.reload} label="orders" />{resource.data && <><OrdersTable orders={resource.data.items} filtered={!!q || !!status} /><Pagination page={resource.data.page} size={resource.data.pageSize} total={resource.data.total} onChange={value => update({ page: String(value) })} /></>}</section></>;
}

export function validateOrder(body: CreateOrderRequest): string | null {
  if (![body.customer.name, body.deliveryAddress.line1, body.deliveryAddress.city, body.deliveryAddress.state, body.deliveryAddress.postalCode].every(value => value.trim())) return 'Enter a customer name and complete delivery address. Spaces alone are not valid.';
  if (!/^\+[1-9]\d{7,14}$/.test(body.customer.phone)) return 'Enter a phone number in international format, starting with + and the country code.';
  return null;
}

function CreateOrder() {
  const [tab, setTab] = useState<'product' | 'direct'>(() => {
    try {
      return new URLSearchParams(window.location.search).get('flow') === 'product' ? 'product' : 'direct';
    } catch { return 'direct'; }
  });
  const [error, setError] = useState(''), [result, setResult] = useState<OrderCreated | null>(null), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), value = (name: string) => String(form.get(name) || '').trim();
    const body: CreateOrderRequest = { sellerReference: value('sellerReference') || undefined, customer: { name: value('name'), phone: value('phone') }, deliveryAddress: { line1: value('line1'), line2: value('line2') || undefined, city: value('city'), state: value('state'), postalCode: value('postalCode') } };
    const invalid = validateOrder(body); if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try { setResult(await ordersApi.create(body)); } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  if (result) return <QrSheet result={result} />;
  return <><BackLink /><PageHead eyebrow="NEW ORDER" title="Create an order" text="Generate dual QR codes instantly by product, or enter full recipient details directly." />
    <div className="no-print" style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
      <button
        type="button"
        className={`button ${tab === 'product' ? 'primary' : 'subtle'}`}
        onClick={() => setTab('product')}
        style={{ minHeight: '38px', fontWeight: 600 }}
      >
        ⚡ Product-First Dual QR Generator (Instant Draft)
      </button>
      <button
        type="button"
        className={`button ${tab === 'direct' ? 'primary' : 'subtle'}`}
        onClick={() => setTab('direct')}
        style={{ minHeight: '38px', fontWeight: 600 }}
      >
        📝 Direct Recipient Form
      </button>
    </div>

    {tab === 'product' ? (
      <DualQrDraftManager onOrderActivated={(id) => { window.location.href = `/orders/${encodeURIComponent(id)}`; }} />
    ) : (
      <form className="panel create-form" onSubmit={submit} aria-busy={busy}>
        <h2>Order details</h2><fieldset disabled={busy}><div className="form-grid">
          <label>Seller reference (optional)<input name="sellerReference" maxLength={100} autoComplete="off" /></label><div className="form-section">RECIPIENT</div>
          <label>Customer name<input name="name" required maxLength={160} autoComplete="name" /></label><label>Phone number<input name="phone" required type="tel" autoComplete="tel" placeholder="+919876543210" /><small className="field-help">Include + and the country code.</small></label>
          <div className="form-section">DELIVERY ADDRESS</div><label className="span2">Address line 1<input name="line1" required maxLength={200} autoComplete="address-line1" /></label><label className="span2">Address line 2 (optional)<input name="line2" maxLength={200} autoComplete="address-line2" /></label>
          <label>City<input name="city" required autoComplete="address-level2" /></label><label>State<input name="state" required autoComplete="address-level1" /></label><label>Postal code<input name="postalCode" required autoComplete="postal-code" /></label>
        </div></fieldset>{error && <ErrorBox message={error} />}<div className="form-actions"><Link to="/orders" className="button subtle">Cancel</Link><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create order'}</button></div>
      </form>
    )}</>;
}

export function Timeline({ events }: { events: Event[] }) {
  const sorted = [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  return <section className="panel timeline-panel"><div className="panel-title"><h2>Activity timeline</h2><span className="muted">{events.length} events · oldest first</span></div>{events.length ? <ol className="timeline">{sorted.map(event => <li className="event" key={event.id}><i aria-hidden="true" /><div><b>{pretty(event.eventType)}</b><small>{pretty(event.actorType)}{event.actorId ? ` · ${event.actorId}` : ''} · {pretty(event.source)} · <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></small>{event.fromStatus && event.toStatus && <span>{pretty(event.fromStatus)} → {pretty(event.toStatus)}</span>}{event.reasonCode && <p>{pretty(event.actorType)}-reported reason: {pretty(event.reasonCode)}</p>}{event.note && <p className="preserve-lines">{event.note}</p>}</div></li>)}</ol> : <p className="muted">No events recorded.</p>}<p className="field-help">Reported reasons describe the source’s account; they do not assign fault.</p></section>;
}

function OrderDetail({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => ordersApi.detail(id, signal), [id]);
  const resource = useResource(id, load);
  const [to, setTo] = useState<OrderStatus | ''>(''), [reason, setReason] = useState<ReasonCode | ''>(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  async function transition(event: FormEvent) {
    event.preventDefault(); if (!to || busy) return;
    const reasonRequired = ['RETURN_INITIATED', 'REDELIVERY_REQUESTED', 'CANCELLED'].includes(to);
    if (reasonRequired && !reason) { setError('Select a reason for this change.'); return; }
    setBusy(true); setError(''); setSuccess('');
    try { await ordersApi.transition(id, { toStatus: to, reasonCode: reason || null, note: note.trim() || null }); setTo(''); setReason(''); setNote(''); setSuccess('Change recorded. The confirmed order is being refreshed.'); resource.reload(); }
    catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  const order = resource.data?.order;
  return <><BackLink />{error && <ErrorBox message={error} />}{success && <p className="notice" role="status">{success}</p>}<ResourceState {...resource} retry={resource.reload} label="order" />{order && <>
    <div className="page-heading"><PageHead eyebrow={order.sellerReference || order.id} title="Order details" text={`Created ${formatDate(order.createdAt)}`} /><button className="button subtle" onClick={() => window.print()}><Printer size={17} /> Print order details</button></div>
    <div className="detail-grid"><section className="panel"><h2>Last confirmed status</h2><Status status={order.status} /><p className="muted">Updated {formatDate(order.updatedAt)}</p><button className="button subtle no-print" onClick={resource.reload} disabled={busy}>Refresh status</button>
      {(sellerSteps[order.status] || []).length > 0 ? <form className="transition-box form-stack no-print" onSubmit={transition}><h3>Record next step</h3><fieldset disabled={busy}><label>Next status<select required value={to} onChange={event => setTo(event.target.value as OrderStatus)}><option value="">Choose next step</option>{sellerSteps[order.status]?.map(status => <option key={status} value={status}>{pretty(status)}</option>)}</select></label>
        <label>Reason<select value={reason} onChange={event => setReason(event.target.value as ReasonCode)} required={['RETURN_INITIATED', 'REDELIVERY_REQUESTED', 'CANCELLED'].includes(to)}><option value="">Select a reason</option>{reasons.map(reason => <option key={reason} value={reason}>{pretty(reason)}</option>)}</select></label>
        <label>Note (optional)<textarea value={note} maxLength={1000} rows={3} onChange={event => setNote(event.target.value)} /></label></fieldset><button className="button primary" disabled={busy || !to}>{busy ? 'Saving…' : 'Record change'}</button><small className="field-help">The server checks permissions and current status. Customer acceptance and verified handoff use the separate QR workflows.</small></form> : <p className="notice">This order has no further seller status actions.</p>}
    </section><section className="panel"><h2>Recipient & destination</h2><dl><dt>Name</dt><dd>{order.customer.name}</dd><dt>Phone</dt><dd>{order.customer.phone}</dd><dt>Delivery address</dt><dd>{order.deliveryAddress.line1}<br />{order.deliveryAddress.line2 && <>{order.deliveryAddress.line2}<br /></>}{order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.postalCode}</dd></dl><p className="field-help">Retrieve and reprint saved labels in the parcel workspace below.</p></section></div>

    {resource.data?.locations && resource.data.locations.length > 0 && (
      <section className="panel" style={{ marginTop: '16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📍 Saved location evidence ({resource.data.locations.length} records)
          </h2>
          <span style={{ fontSize: '11px', color: '#64748b' }}>Device-reported coordinates and accuracy</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {resource.data.locations.map((loc: any) => (
            <div key={loc.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '12px' }}>
                  {loc.kind.replace('_', ' ')}
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{formatDate(loc.capturedAt || loc.createdAt)}</span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', margin: '4px 0' }}>
                {loc.latitude?.toFixed(5)}° N, {loc.longitude?.toFixed(5)}° E
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>
                Accuracy radius: ±{Math.round(loc.accuracyMeters || 10)} meters
              </div>
              <a
                href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="button subtle"
                style={{ fontSize: '11px', minHeight: '30px', padding: '4px 10px', width: '100%', justifyContent: 'center' }}
              >
                View on Google Maps &rarr;
              </a>
            </div>
          ))}
        </div>
      </section>
    )}

    <ParcelPanel id={id} />
    <Timeline events={resource.data?.events || []} />
  </>}</>;
}
