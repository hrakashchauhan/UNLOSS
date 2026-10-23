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

  it('requires an assigned account when opening a parcel QR', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({error:{code:'UNAUTHENTICATED',message:'Sign in required'}},{status:401}));
    vi.stubGlobal('fetch',fetchMock);
    render(<MemoryRouter initialEntries={['/delivery/public-token']}><App/></MemoryRouter>);
    expect(await screen.findByText(/Possessing a QR alone/)).toBeTruthy();
    expect(screen.getByRole('link',{name:'Sign in to continue'}).getAttribute('href')).toContain('%2Fscan%2Fdelivery%2Fpublic-token');
    expect(screen.queryByRole('button',{name:/handoff/i})).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toContain('/workspace/resolve/delivery/public-token');
  });

  it('navigates from the persisted dashboard summary to orders', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(Response.json({ seller: { id: 'seller-1', name: 'Demo Seller', email: 'demo@unloss.local' }, mode: 'demo' }));
      if (input.endsWith('/dashboard/summary')) return Promise.resolve(Response.json({ totalOrders: 0, statusCounts: {}, rewardTotalPaise: 0 }));
      if (input.includes('/orders?')) return Promise.resolve(Response.json({ items: [], page: 1, pageSize: 25, total: 0 }));
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Delivery overview' })).toBeTruthy();
    expect(screen.getByText(/DATABASE-BACKED LOCAL DEMO/)).toBeTruthy();
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
