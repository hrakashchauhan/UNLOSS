// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';

const seller = { id: 'seller-1', name: 'Demo Seller', email: 'demo@unloss.local' };
const noSession = () => Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 });
const emptyOrders = () => Response.json({ items: [], page: 1, pageSize: 25, total: 0 });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('seller session', () => {
  it('distinguishes an unavailable API from a signed-out session and supports retry', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(noSession());
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/orders']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Unable to check your session' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('signs in once and returns to the requested protected route', async () => {
    let completeLogin!: (response: Response) => void;
    const loginResponse = new Promise<Response>(resolve => { completeLogin = resolve; });
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(noSession());
      if (input.endsWith('/auth/login')) return loginResponse;
      if (input.includes('/orders?')) return Promise.resolve(emptyOrders());
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/orders']}><App /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email address' }), { target: { value: seller.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'demo-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Signing in…' }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/login'))).toHaveLength(1);
    completeLogin(Response.json({ seller }));
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeTruthy();
  });

  it('shows invalid credentials without treating them as an expired session', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(noSession());
      if (input.endsWith('/auth/login')) return Promise.resolve(Response.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }, { status: 401 }));
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email address' }), { target: { value: seller.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Email or password is incorrect');
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('keeps the seller signed in when logout fails, then signs out on a successful retry', async () => {
    let logoutCalls = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(Response.json({ seller }));
      if (input.endsWith('/dashboard/summary')) return Promise.resolve(Response.json({ totalOrders: 0, statusCounts: {}, rewardTotalPaise: 0 }));
      if (input.includes('/orders?')) return Promise.resolve(emptyOrders());
      if (input.endsWith('/auth/logout')) return ++logoutCalls === 1 ? Promise.reject(new TypeError('offline')) : Promise.resolve(new Response(null, { status: 204 }));
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Delivery overview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Delivery overview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('redirects to sign-in when a seller data request reports session expiry', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.endsWith('/auth/me')) return Promise.resolve(Response.json({ seller }));
      if (input.endsWith('/dashboard/summary')) return Promise.resolve(noSession());
      if (input.includes('/orders?')) return Promise.resolve(emptyOrders());
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/dashboard/summary'))).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });
});
