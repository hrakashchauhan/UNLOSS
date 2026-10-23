// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DualQrDraftManager } from './DualQrDraftManager';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mockDraft = {
  id: 'draft-abc-12345678',
  sellerId: 'seller-1',
  productId: 'prod-1',
  quantity: 2,
  status: 'DRAFT',
  recipientName: null,
  recipientPhone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  courier: null,
  trackingNumber: null,
  archivedAt: null,
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  product: { id: 'prod-1', name: 'Ergonomic Chair', sku: 'CHR-1', createdAt: '2026-10-24T00:00:00Z' },
  tokens: [
    { id: 'tok-1', draftId: 'draft-abc-12345678', purpose: 'DELIVERY', tokenHash: 'hash-del', encryptedToken: 'bW9jay1kZWxpdmVyeS10b2tlbg', expiresAt: '2026-11-24T00:00:00Z', revokedAt: null },
    { id: 'tok-2', draftId: 'draft-abc-12345678', purpose: 'CUSTOMER', tokenHash: 'hash-cust', encryptedToken: 'bW9jay1jdXN0b21lci10b2tlbg', expiresAt: '2026-11-24T00:00:00Z', revokedAt: null },
  ],
};

const mockCreated = {
  draft: mockDraft,
  product: mockDraft.product,
  qr: {
    deliveryUrl: 'http://localhost:3000/draft/delivery/mock-delivery-token-43charslongxxxxxxx',
    customerUrl: 'http://localhost:3000/draft/customer/mock-customer-token-43charslongxxxxxxx',
  },
  status: 'AWAITING_ACTIVATION',
};

beforeEach(() => {
  // Mock clipboard API
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

it('creates a draft immediately upon entering a product name and displays dual QR codes', async () => {
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/drafts') && options?.method === 'POST') {
      return Promise.resolve(Response.json(mockCreated, { status: 201 }));
    }
    if (url.endsWith('/drafts') && (!options?.method || options.method === 'GET')) {
      return Promise.resolve(Response.json({ items: [] }));
    }
    return Promise.resolve(Response.json({}));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <DualQrDraftManager />
    </MemoryRouter>
  );

  // Initial render shows product input
  const input = screen.getByPlaceholderText(/Handmade Ceramic Vase/i);
  fireEvent.change(input, { target: { value: 'Ergonomic Chair' } });

  const submitBtn = screen.getByRole('button', { name: /Save Draft & Generate Dual QR/i });
  fireEvent.click(submitBtn);

  // Wait for dual QR cards to appear
  expect(await screen.findByText(/DELIVERY WORKFLOW QR/i)).toBeTruthy();
  expect(screen.getByText(/CUSTOMER VERIFICATION QR/i)).toBeTruthy();
  expect(screen.getByText(/PERSISTENT DRAFT: #12345678/i)).toBeTruthy();
  expect(screen.getByText(/Ergonomic Chair \(Qty: 2\)/i)).toBeTruthy();

  // Both SVGs must be present
  const svgs = document.querySelectorAll('svg');
  expect(svgs.length).toBeGreaterThanOrEqual(2);
});

it('copies delivery QR link to clipboard', async () => {
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/drafts') && options?.method === 'POST') {
      return Promise.resolve(Response.json(mockCreated, { status: 201 }));
    }
    return Promise.resolve(Response.json({ items: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <DualQrDraftManager />
    </MemoryRouter>
  );

  fireEvent.change(screen.getByPlaceholderText(/Handmade Ceramic Vase/i), { target: { value: 'Ergonomic Chair' } });
  fireEvent.click(screen.getByRole('button', { name: /Save Draft & Generate Dual QR/i }));

  await screen.findByText(/DELIVERY WORKFLOW QR/i);

  const copyButtons = screen.getAllByRole('button', { name: /Copy Link/i });
  fireEvent.click(copyButtons[0]);

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockCreated.qr.deliveryUrl);
  expect(await screen.findByText(/Delivery QR link copied to clipboard!/i)).toBeTruthy();
});

it('duplicates draft with fresh QR tokens', async () => {
  const duplicatedMock = {
    draft: { ...mockDraft, id: 'draft-xyz-98765432' },
    qr: {
      deliveryUrl: 'http://localhost:3000/draft/delivery/fresh-delivery-token-43charslongxxxxxx',
      customerUrl: 'http://localhost:3000/draft/customer/fresh-customer-token-43charslongxxxxxx',
    },
  };

  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/drafts') && options?.method === 'POST') {
      return Promise.resolve(Response.json(mockCreated, { status: 201 }));
    }
    if (url.includes('/duplicate')) {
      return Promise.resolve(Response.json(duplicatedMock, { status: 201 }));
    }
    return Promise.resolve(Response.json({ items: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <DualQrDraftManager />
    </MemoryRouter>
  );

  fireEvent.change(screen.getByPlaceholderText(/Handmade Ceramic Vase/i), { target: { value: 'Ergonomic Chair' } });
  fireEvent.click(screen.getByRole('button', { name: /Save Draft & Generate Dual QR/i }));
  await screen.findByText(/DELIVERY WORKFLOW QR/i);

  const dupBtn = screen.getByRole('button', { name: /Duplicate/i });
  fireEvent.click(dupBtn);

  expect(await screen.findByText(/Draft duplicated with a fresh set of high-entropy QR tokens./i)).toBeTruthy();
  expect(screen.getByText(/PERSISTENT DRAFT: #98765432/i)).toBeTruthy();
});

it('saves recipient details and activates draft into a live order', async () => {
  const onOrderActivated = vi.fn();
  const updatedDraft = {
    ...mockDraft,
    recipientName: 'Arjun Verma',
    recipientPhone: '+919876543210',
    addressLine1: 'Flat 402, Green Glen',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560103',
  };

  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/drafts') && options?.method === 'POST') {
      return Promise.resolve(Response.json(mockCreated, { status: 201 }));
    }
    if (url.includes('/drafts/') && options?.method === 'PATCH') {
      return Promise.resolve(Response.json({ draft: updatedDraft }));
    }
    if (url.includes('/activate')) {
      return Promise.resolve(Response.json({
        orderId: 'live-order-999',
        qr: {
          deliveryUrl: 'http://localhost:3000/delivery/live-delivery-token',
          customerUrl: 'http://localhost:3000/customer/live-customer-token',
        },
      }, { status: 201 }));
    }
    return Promise.resolve(Response.json({ items: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <DualQrDraftManager onOrderActivated={onOrderActivated} />
    </MemoryRouter>
  );

  fireEvent.change(screen.getByPlaceholderText(/Handmade Ceramic Vase/i), { target: { value: 'Ergonomic Chair' } });
  fireEvent.click(screen.getByRole('button', { name: /Save Draft & Generate Dual QR/i }));
  await screen.findByText(/DELIVERY WORKFLOW QR/i);

  // Fill in recipient details
  fireEvent.change(screen.getByPlaceholderText(/Ramesh Sharma/i), { target: { value: 'Arjun Verma' } });
  fireEvent.change(screen.getByPlaceholderText(/Flat \/ House No\./i), { target: { value: 'Flat 402, Green Glen' } });

  // Save details
  const saveBtn = screen.getByRole('button', { name: /Save Details to Draft/i });
  fireEvent.click(saveBtn);
  expect(await screen.findByText(/Shipment and recipient details saved to persistent draft./i)).toBeTruthy();

  // Activate order
  const activateBtn = screen.getByRole('button', { name: /Activate Draft into Live Order/i });
  expect((activateBtn as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(activateBtn);

  await waitFor(() => {
    expect(onOrderActivated).toHaveBeenCalledWith('live-order-999');
  });
  expect(await screen.findByText(/Order activated successfully! Order ID: live-order-999/i)).toBeTruthy();
});
