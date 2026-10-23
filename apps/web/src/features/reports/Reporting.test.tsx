// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationsPage, ReportsPage, RewardsPage, reportRange } from './Reporting';
import type { MonthlyReport } from '../../api';

const report: MonthlyReport = { month: '2026-10', timezone: 'Asia/Kolkata', periodStart: '2026-09-30T18:30:00.000Z', periodEnd: '2026-10-31T18:30:00.000Z', totalOrdersCreated: 1, ordersDispatched: 0, deliveryAttempts: 0, verifiedCompletions: 0, returnsToSeller: 0, returnRate: null, returnRateNumerator: 0, returnRateDenominator: 0, redeliveryRequests: 0, rewardCreditCount: 0, rewardTotalPaise: 0, reasonCounts: {} };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('formats the final included date without presenting next month as included', () => { expect(reportRange(report)).toBe('1 Oct 2026 – 31 Oct 2026'); });
it('shows a zero-denominator report and downloads CSV for the selected month', async () => {
  const csv = 'month,timezone,period_start,period_end,total_orders_created\r\n"2026-10","Asia/Kolkata","start","end",1';
  const fetchMock = vi.fn((url: string) => Promise.resolve(url.includes('.csv') ? new Response(csv, { headers: { 'Content-Type': 'text/csv' } }) : Response.json(report))); vi.stubGlobal('fetch', fetchMock);
  const createObjectURL = vi.fn().mockReturnValue('blob:test'); vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<ReportsPage />); await screen.findByText('Not available');
  expect(screen.getByText(/No dispatch events/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Report month'), { target: { value: '2026-10' } }); await screen.findByText('Not available');
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  expect(await screen.findByText('CSV downloaded for 2026-10.')).toBeTruthy(); expect(click).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/reports/monthly.csv?month=2026-10');
});
it('shows report fetch failures and retries without fabricated metrics', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(Response.json(report)); vi.stubGlobal('fetch', fetchMock);
  render(<ReportsPage />); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByText('Orders created')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(await screen.findByText('Orders created')).toBeTruthy();
});
it('paginates notifications and ledger entries through their existing endpoints', async () => {
  const fetchMock = vi.fn((url: string) => Promise.resolve(Response.json(url.includes('/summary') ? { creditCount: 0, totalPaise: 0, currency: 'INR' } : { items: [], page: url.includes('page=2') ? 2 : 1, pageSize: 25, total: 26 }))); vi.stubGlobal('fetch', fetchMock);
  render(<NotificationsPage />); await screen.findByText('No notifications recorded'); fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/notifications?page=2')); cleanup();
  render(<MemoryRouter><RewardsPage /></MemoryRouter>); await screen.findByText('No reward entries'); fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/rewards/ledger?page=2'))).toBe(true));
});
