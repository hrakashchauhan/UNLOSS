// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { Pagination } from './ui/common';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('routing and common controls', () => {
  it('shows seller sign-in on a protected route when the API reports no session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 })));
    render(<MemoryRouter initialEntries={['/orders']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('shows a public link preview without enabling an unverified delivery action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ orderReference: 'REF-1', status: 'OUT_FOR_DELIVERY', permittedOutcomes: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/delivery/public-token']}><App /></MemoryRouter>);
    expect(await screen.findByText('REF-1', { exact: false })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Actions temporarily unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/delivery/public-token');
  });

  it('navigates from the persisted dashboard summary to orders', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(Response.json({ seller: { id: 'seller-1', name: 'Demo Seller', email: 'demo@unloss.local' } }));
      if (input.endsWith('/dashboard/summary')) return Promise.resolve(Response.json({ totalOrders: 0, statusCounts: {}, rewardTotalPaise: 0 }));
      if (input.includes('/orders?')) return Promise.resolve(Response.json({ items: [], page: 1, pageSize: 25, total: 0 }));
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Delivery overview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/orders?'))).toBe(true);
  });

  it('shows a useful page for unknown routes', () => {
    render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeTruthy();
  });

  it('bounds pagination at the first and last page', () => {
    const onChange = vi.fn();
    render(<MemoryRouter><Pagination page={1} size={25} total={26} onChange={onChange} /></MemoryRouter>);
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
