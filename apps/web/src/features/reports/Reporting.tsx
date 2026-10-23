import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Box } from 'lucide-react';
import { api, ordersApi, qs, type DashboardSummary, type LedgerEntry, type MonthlyReport, type Notification, type Page, type RewardSummary } from '../../api';
import { currentMonth, money } from '../../domain';
import { Empty, ErrorBox, PageHead, Pagination, errText, formatDate, pretty } from '../../ui/common';
import { ResourceState } from '../../ui/ResourceState';
import { useResource } from '../../ui/useResource';
import { OrdersTable } from '../orders/Orders';

export function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return <div className="stat-card"><div className="stat-top">{label}</div><strong>{value}</strong><small>{sub}</small></div>;
}
export function Dashboard() {
  const load = useCallback(async (signal: AbortSignal) => {
    const [summary, orders] = await Promise.all([api<DashboardSummary>('/dashboard/summary', { signal }), ordersApi.list({ page: 1, pageSize: 5 }, signal)]);
    return { summary, orders };
  }, []);
  const resource = useResource('dashboard', load), data = resource.data?.summary;
  return <><div className="page-heading"><PageHead eyebrow="SELLER WORKSPACE" title="Delivery overview" text="Current order counts from your saved records." /><Link className="button primary" to="/orders/new">Create an order</Link></div>
    <ResourceState {...resource} retry={resource.reload} label="overview" />{data && <><div className="stat-grid"><Stat label="Total orders" value={data.totalOrders} sub="All time" /><Stat label="Out for delivery" value={data.statusCounts.OUT_FOR_DELIVERY || 0} sub="Current status" /><Stat label="Verified deliveries" value={data.statusCounts.DELIVERED_VERIFIED || 0} sub="Current status" /><Stat label="Returned to seller" value={data.statusCounts.RETURNED_TO_SELLER || 0} sub="Current status" /></div>
    <div className="dashboard-grid"><section className="panel table-panel"><div className="panel-title"><h2>Recent orders</h2><Link to="/orders">View all orders</Link></div><OrdersTable orders={resource.data!.orders.items} /></section><section className="panel"><h2>Next steps</h2><div className="quick-links"><Link to="/orders/new">Create a new order →</Link><Link to="/returns">Review returns and redelivery →</Link><Link to="/reports">Inspect monthly activity →</Link><Link to="/rewards">Internal reward ledger: {money(data.rewardTotalPaise)} →</Link></div><p className="notice">₹5 credits require customer OTP acceptance and an eligible delivery handoff. No payout is offered.</p></section></div>
    <section className="panel"><h2>Orders by confirmed status</h2><div className="status-summary">{Object.entries(data.statusCounts).map(([status, count]) => <Link key={status} to={`/orders?status=${encodeURIComponent(status)}`}><span>{pretty(status)}</span><b>{count}</b></Link>)}</div>{!Object.keys(data.statusCounts).length && <p className="muted">No saved orders yet.</p>}<button className="button subtle" onClick={resource.reload}>Refresh overview</button></section></>}</>;
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
