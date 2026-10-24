// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderWorkspace(path: string) {
  const user = { id: 'linked-user', name: 'Alex Account', email: 'alex@example.invalid', phone: null, roles: ['CUSTOMER', 'DELIVERY'], deliveryStatus: 'APPROVED' };
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.endsWith('/auth/me')) return Response.json({ user, mode: 'manual' });
    if (input.endsWith('/workspace/parcels')) return Response.json({ items: [{
      id: 'parcel-12345678', sellerReference: 'REF-1001', itemName: 'Oak desk', quantity: 2,
      product: { name: 'Oak desk', sku: 'DESK-01' }, status: 'OUT_FOR_DELIVERY', updatedAt: '2026-10-24T00:00:00.000Z',
      deliveryAttempt: 1, customerName: 'Jamie Recipient', customerUser: { name: 'Jamie Recipient' },
      claims: [{ deliveryUser: { name: 'Taylor Courier' } }],
    }] });
    if (input.endsWith('/workspace/wallet')) return Response.json({ totalPaise: 0, lockedPaise: 0, availablePaise: 0, providerConnected: false, account: null, earnings: [], withdrawals: [] });
    throw new Error(`Unexpected request: ${input}`);
  }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

it('shows connected product, recipient and courier on the selected delivery dashboard', async () => {
  renderWorkspace('/delivery-portal');
  expect(await screen.findByRole('heading', { name: 'Delivery dashboard' })).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'Oak desk' })).toBeTruthy();
  expect(screen.getByText('Jamie Recipient')).toBeTruthy();
  expect(screen.getByText('Taylor Courier')).toBeTruthy();
  expect(screen.getByText(/DESK-01/)).toBeTruthy();
});

it('keeps the customer dashboard label when a multi-role account selects customer view', async () => {
  renderWorkspace('/customer-portal');
  expect(await screen.findByRole('heading', { name: 'My deliveries' })).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'Oak desk' })).toBeTruthy();
});
