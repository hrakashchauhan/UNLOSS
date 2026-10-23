import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Box } from 'lucide-react';
import { api, ordersApi, qs, type DashboardSummary, type LedgerEntry, type MonthlyReport, type Notification, type Page, type RewardSummary } from '../../api';
import { currentMonth, money } from '../../domain';
import { Empty, ErrorBox, PageHead, Pagination, errText, formatDate, pretty } from '../../ui/common';
import { ResourceState } from '../../ui/ResourceState';
import { useResource } from '../../ui/useResource';
import { OrdersTable } from '../orders/Orders';

import { claimsApi, fundingApi, type ParcelClaim, type FundingAccount, type BudgetReservation } from '../../api';
import { AlertCircle, CheckCircle2, CreditCard, Plus, Truck, XCircle } from 'lucide-react';

export function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return <div className="stat-card"><div className="stat-top">{label}</div><strong>{value}</strong><small>{sub}</small></div>;
}

export function Dashboard() {
  const [topUpModal, setTopUpModal] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('500');
  const [fundingBusy, setFundingBusy] = useState(false);
  const [claimActionBusy, setClaimActionBusy] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState('');

  const load = useCallback(async (signal: AbortSignal) => {
    const [summary, orders, claimsRes, fundingRes] = await Promise.all([
      api<DashboardSummary>('/dashboard/summary', { signal }),
      ordersApi.list({ page: 1, pageSize: 5 }, signal),
      claimsApi.sellerClaims(signal).catch(() => ({ items: [] as ParcelClaim[] })),
      fundingApi.getSummary(signal).catch(() => ({ account: { availablePaise: 0, reservedPaise: 0, refundedPaise: 0 }, txns: [], reservations: [], earnings: [] })),
    ]);
    return { summary, orders, claims: claimsRes.items, funding: fundingRes };
  }, []);

  const resource = useResource('dashboard', load);
  const data = resource.data?.summary;
  const claims = resource.data?.claims || [];
  const funding = resource.data?.funding?.account;

  async function handleClaimDecision(claimId: string, action: 'APPROVE' | 'REJECT') {
    setClaimActionBusy(claimId);
    setActionNotice('');
    try {
      await claimsApi.decide(claimId, action, action === 'REJECT' ? 'Seller review declined' : undefined);
      setActionNotice(`Claim ${action === 'APPROVE' ? 'approved' : 'rejected'}. Order status updated.`);
      resource.reload();
    } catch (e) {
      setActionNotice(`Action failed: ${errText(e)}`);
    } finally {
      setClaimActionBusy(null);
    }
  }

  async function handleTopUp(e: FormEvent) {
    e.preventDefault();
    const amountRupees = Number(topUpAmount) || 500;
    const amountPaise = amountRupees * 100;
    setFundingBusy(true);
    setActionNotice('');
    try {
      const checkout = await fundingApi.checkout(amountPaise);
      const fakePaymentId = `pay_sim_${Date.now().toString(36)}`;
      await fundingApi.capture(checkout.providerOrderId, fakePaymentId);
      setActionNotice(`₹${amountRupees} added to your reward budget via Razorpay sandbox.`);
      setTopUpModal(false);
      resource.reload();
    } catch (e) {
      setActionNotice(`Top-up failed: ${errText(e)}`);
    } finally {
      setFundingBusy(false);
    }
  }

  return <>
    <div className="page-heading">
      <PageHead eyebrow="SELLER WORKSPACE" title="Delivery overview" text="Current order records, delivery claims, and reward budget status." />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button className="button subtle" onClick={() => setTopUpModal(true)}>
          <CreditCard size={15} style={{ marginRight: '6px' }} /> Top Up Budget
        </button>
        <Link className="button primary" to="/orders/new">
          <Plus size={15} style={{ marginRight: '4px' }} /> Create an order / Dual QR
        </Link>
      </div>
    </div>

    {actionNotice && <p className="notice" role="status" style={{ marginBottom: '16px' }}>{actionNotice}</p>}

    <ResourceState {...resource} retry={resource.reload} label="overview" />

    {data && <>
      {/* Top Funding & Stats Bar */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Stat label="Total orders" value={data.totalOrders} sub="All time records" />
        <Stat label="Out for delivery" value={data.statusCounts.OUT_FOR_DELIVERY || 0} sub="In transit / dispatched" />
        <Stat label="Verified deliveries" value={data.statusCounts.DELIVERED_VERIFIED || 0} sub="OTP confirmed completions" />
        <Stat label="Returned to seller" value={data.statusCounts.RETURNED_TO_SELLER || 0} sub="Recorded returns" />
        <Stat
          label="Reward Budget (Available)"
          value={money(funding?.availablePaise || 0)}
          sub={`Reserved: ${money(funding?.reservedPaise || 0)}`}
        />
      </div>

      {/* Pending Delivery Claims Banner */}
      {claims.length > 0 && (
        <section className="panel" style={{ background: '#fdfaf2', border: '1px solid #ebd9b0', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#875a00', fontWeight: 700, marginBottom: '8px' }}>
            <AlertCircle size={18} />
            <span>PENDING DELIVERY CLAIMS ({claims.length})</span>
          </div>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            Delivery personnel have requested assignment for the following out-for-delivery packages. Review and approve to grant handoff authorization.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Order Ref</th>
                  <th>Courier Partner</th>
                  <th>Claimed At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map(claim => (
                  <tr key={claim.id}>
                    <td><b>{claim.order?.sellerReference || claim.orderId}</b></td>
                    <td>{claim.deliveryUser?.name || 'Courier Rider'} ({claim.deliveryUser?.phone || 'No phone'})</td>
                    <td>{formatDate(claim.claimedAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="button primary"
                          style={{ minHeight: '30px', fontSize: '.78rem', padding: '2px 10px' }}
                          disabled={claimActionBusy === claim.id}
                          onClick={() => handleClaimDecision(claim.id, 'APPROVE')}
                        >
                          <CheckCircle2 size={12} style={{ marginRight: '4px' }} /> Approve Claim
                        </button>
                        <button
                          className="button subtle"
                          style={{ minHeight: '30px', fontSize: '.78rem', padding: '2px 10px', color: '#d74032' }}
                          disabled={claimActionBusy === claim.id}
                          onClick={() => handleClaimDecision(claim.id, 'REJECT')}
                        >
                          <XCircle size={12} style={{ marginRight: '4px' }} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent Orders & Quick Actions */}
      <div className="dashboard-grid">
        <section className="panel table-panel">
          <div className="panel-title">
            <h2>Recent orders</h2>
            <Link to="/orders">View all orders</Link>
          </div>
          <OrdersTable orders={resource.data!.orders.items} />
        </section>

        <section className="panel">
          <h2>Next steps & Operations</h2>
          <div className="quick-links">
            <Link to="/orders/new">⚡ Instant Dual QR Generator →</Link>
            <Link to="/returns">Inspect reported return reasons →</Link>
            <Link to="/reports">Monthly compliance report & CSV →</Link>
            <Link to="/rewards">Reward ledger: {money(data.rewardTotalPaise)} →</Link>
          </div>
          <p className="notice" style={{ marginTop: '16px' }}>
            ₹5 reward credits are reserved from your funding budget and awarded once an order satisfies customer OTP acceptance and verified handoff.
          </p>
        </section>
      </div>

      <section className="panel">
        <h2>Orders by confirmed status</h2>
        <div className="status-summary">
          {Object.entries(data.statusCounts).map(([status, count]) => (
            <Link key={status} to={`/orders?status=${encodeURIComponent(status)}`}>
              <span>{pretty(status)}</span>
              <b>{count}</b>
            </Link>
          ))}
        </div>
        {!Object.keys(data.statusCounts).length && <p className="muted">No saved orders yet.</p>}
        <button className="button subtle" style={{ marginTop: '12px' }} onClick={resource.reload}>
          Refresh overview
        </button>
      </section>
    </>}

    {/* Top Up Budget Modal */}
    {topUpModal && (
      <div className="nav-scrim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setTopUpModal(false)}>
        <div className="panel" style={{ width: '90%', maxWidth: '440px', background: '#fff', padding: '24px', borderRadius: '8px' }} onClick={e => e.stopPropagation()}>
          <div className="eyebrow" style={{ color: 'var(--primary)', fontWeight: 700 }}>RAZORPAY SANDBOX</div>
          <h3 style={{ margin: '4px 0 12px' }}>Top Up Reward Budget</h3>
          <p className="muted" style={{ fontSize: '.86rem', margin: '0 0 16px' }}>
            Add budget to fund ₹5 completion rewards for verified deliveries. In local demo mode, transactions are instantly captured with idempotency.
          </p>
          <form onSubmit={handleTopUp}>
            <label style={{ display: 'block', marginBottom: '16px' }}>
              <span>Top-Up Amount (INR ₹):</span>
              <input
                type="number"
                min={100}
                max={50000}
                step={100}
                value={topUpAmount}
                onChange={e => setTopUpAmount(e.target.value)}
                required
                style={{ width: '100%', minHeight: '40px', padding: '8px 12px', fontSize: '1.1rem', fontWeight: 600 }}
              />
              <small className="field-help">Recommended minimum: ₹500 (covers 80+ deliveries at ₹6 reserve each).</small>
            </label>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="button subtle" onClick={() => setTopUpModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={fundingBusy}>
                {fundingBusy ? 'Processing…' : `Pay ₹${topUpAmount} via Sandbox`}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>;
}

export function RewardsPage() {
  const [page, setPage] = useState(1);
  const load = useCallback(async (signal: AbortSignal) => {
    const [summary, ledger] = await Promise.all([api<RewardSummary>('/rewards/summary', { signal }), api<Page<LedgerEntry>>(`/rewards/ledger${qs({ page, pageSize: 25 })}`, { signal })]);
    return { summary, ledger };
  }, [page]);
  const resource = useResource(String(page), load), data = resource.data;
  return <><PageHead eyebrow="REWARDS" title="Internal reward ledger" text="An accounting record of eligible ₹5 delivery credits. No cash transfer, wallet, or withdrawal is offered." /><ResourceState {...resource} retry={resource.reload} label="reward records" />{data && <>
    <div className="stat-grid two"><Stat label="Delivery reward credits" value={data.summary.creditCount} sub="Confirmed by the backend" /><Stat label="Total delivery rewards" value={money(data.summary.totalPaise)} sub="Internal ledger · INR" /></div>
    <section className="panel table-panel">{data.ledger.items.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Reward records"><table><caption className="sr-only">Internal ledger entries</caption><thead><tr><th>Date</th><th>Order</th><th>Entry</th><th>Amount</th><th>Eligibility reason</th></tr></thead><tbody>{data.ledger.items.map(entry => <tr key={entry.id}><td>{formatDate(entry.createdAt)}</td><td><Link className="order-link" to={`/orders/${encodeURIComponent(entry.orderId)}`}>{entry.orderId.slice(-8)}</Link></td><td>{pretty(entry.type)}</td><td className="amount">{money(entry.amountPaise)}</td><td>{pretty(entry.eligibilityReason)}</td></tr>)}</tbody></table></div> : <Empty icon={<Box />} title="No reward entries" text="An eligible customer-verified handoff creates a single ₹5 credit on the backend." />}<Pagination page={data.ledger.page} size={data.ledger.pageSize} total={data.ledger.total} onChange={setPage} /></section>
    <p className="field-help">Summary totals count delivery rewards. Reversals, when supported, appear as separate ledger entries.</p></>}</>;
}

export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const load = useCallback((signal: AbortSignal) => api<Page<Notification>>(`/notifications${qs({ page, pageSize: 25 })}`, { signal }), [page]);
  const resource = useResource(String(page), load);
  return <><div className="page-heading"><PageHead eyebrow="UPDATES" title="Notifications" text="Messages recorded by UNLOSS for your seller account." /><button className="button subtle" disabled={resource.loading} onClick={resource.reload}>Refresh</button></div><section className="panel"><ResourceState {...resource} retry={resource.reload} label="notifications" />{resource.data && <>{resource.data.items.length ? <ul className="notification-list">{resource.data.items.map(item => <li className="notification" key={item.id}><Bell size={20} aria-hidden="true" /><div><b>{item.title}</b><p>{item.body}</p><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div></li>)}</ul> : <Empty icon={<Bell />} title="No notifications recorded" text="This view displays saved messages. Check order timelines for the latest activity." />}<Pagination page={resource.data.page} size={resource.data.pageSize} total={resource.data.total} onChange={setPage} /></>}</section></>;
}

export function reportRange(report: Pick<MonthlyReport, 'periodStart' | 'periodEnd' | 'timezone'>) {
  const format = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: report.timezone });
  return `${format.format(new Date(report.periodStart))} – ${format.format(new Date(Date.parse(report.periodEnd) - 1))}`;
}
export function ReportsPage() {
  const [month, setMonth] = useState(currentMonth), [exporting, setExporting] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const load = useCallback((signal: AbortSignal) => api<MonthlyReport>(`/reports/monthly${qs({ month })}`, { signal }), [month]);
  const resource = useResource(month, load), data = resource.data;
  async function csv() {
    if (!data || exporting) return; setExporting(true); setError(''); setSuccess('');
    try {
      const content = await api<string>(`/reports/monthly.csv${qs({ month: data.month })}`);
      if (typeof content !== 'string' || !content.startsWith('month,timezone,period_start,period_end,')) throw new Error('The server returned an unexpected CSV format.');
      const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a');
      link.href = url; link.download = `unloss-report-${data.month}.csv`; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setSuccess(`CSV downloaded for ${data.month}.`);
    } catch (cause) { setError(errText(cause)); } finally { setExporting(false); }
  }
  return <><div className="page-heading"><PageHead eyebrow="REPORTS" title="Monthly report" text="Recorded activity within a calendar month, in Asia/Kolkata time." /><div className="report-actions"><label>Report month<input type="month" value={month} disabled={exporting} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { setMonth(event.target.value); setError(''); setSuccess(''); } }} /></label><button className="button subtle" onClick={csv} disabled={!data || exporting}>{exporting ? 'Downloading…' : 'Download CSV'}</button></div></div>
    {error && <ErrorBox message={error} />}{success && <p className="notice" role="status">{success}</p>}<ResourceState {...resource} retry={resource.reload} label="report" />{data && <>
    <p className="report-period">{reportRange(data)} · {data.timezone} · End boundary is exclusive in the API and CSV.</p>
    <div className="stat-grid report-stats"><Stat label="Orders created" value={data.totalOrdersCreated} sub="Creation events" /><Stat label="Dispatches" value={data.ordersDispatched} sub="Dispatch events, including retries" /><Stat label="Delivery attempts" value={data.deliveryAttempts} sub="Recorded attempt events" /><Stat label="Verified completions" value={data.verifiedCompletions} sub="Completion events" /><Stat label="Returns to seller" value={data.returnsToSeller} sub="Return completion events" /><Stat label="Redelivery requests" value={data.redeliveryRequests} sub="Recorded status events" /><Stat label="Reward credits" value={data.rewardCreditCount} sub="Eligible ledger credits" /><Stat label="Internal reward value" value={money(data.rewardTotalPaise)} sub="No payout" /></div>
    <section className="panel"><h2>Return rate</h2><div className="rate-value">{data.returnRate === null ? 'Not available' : `${(data.returnRate * 100).toFixed(1)}%`}</div><p>{data.returnRateNumerator} return events ÷ {data.returnRateDenominator} dispatch events in this month.</p><p className="muted">{data.returnRateDenominator === 0 ? 'No dispatch events: a rate cannot be calculated. ' : ''}This compares events in the same period, not a single shipment cohort. A parcel may appear more than once and returns may relate to earlier dispatches.</p></section>
    <section className="panel"><h2>Recorded reasons</h2>{Object.keys(data.reasonCounts).length ? Object.entries(data.reasonCounts).map(([reason, count]) => <div className="reason-row" key={reason}><span>{pretty(reason)}</span><b>{count}</b></div>) : <p className="muted">No reason events recorded this month.</p>}<p className="field-help">The CSV repeats period totals for each reason row; do not sum those repeated totals.</p></section>
  </>}</>;
}
