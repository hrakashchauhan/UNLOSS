// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, normalizeOrder, ordersApi, type RawOrder } from './api';

const rawOrder: RawOrder = {
  id: 'order-1', sellerId: 'seller-1', sellerReference: 'REF-1', status: 'CREATED',
  customerName: 'Asha', customerPhone: '+919876543210', addressLine1: '10 Road', addressLine2: null,
  city: 'Pune', state: 'Maharashtra', postalCode: '411001', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('API boundary', () => {
  it('maps persisted flat order fields into the view model without losing private seller fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [rawOrder], page: 1, pageSize: 25, total: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const page = await ordersApi.list({ page: 1, pageSize: 25 });
    expect(page.items[0]).toEqual(normalizeOrder(rawOrder));
    expect(page.items[0].customer).toEqual({ name: 'Asha', phone: '+919876543210' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('keeps server error code, validation details, and request ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'INVALID_TRANSITION', message: 'Move denied', details: { toStatus: 'CANCELLED' } }, requestId: 'req-7' }, { status: 409 })));
    await expect(api('/orders/1/transitions', { method: 'POST' })).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION', requestId: 'req-7', details: { toStatus: 'CANCELLED' } });
  });

  it('handles logout, CSV, and invalid HTML responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('month,total\n2026-10,2', { headers: { 'Content-Type': 'text/csv' } }))
      .mockResolvedValueOnce(new Response('<html>proxy error</html>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api<void>('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    await expect(api<string>('/reports/monthly.csv?month=2026-10')).resolves.toContain('2026-10,2');
    await expect(api('/auth/me')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports network failure and preserves explicit cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError')));
    await expect(api('/orders')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(api('/orders')).rejects.toMatchObject({ name: 'AbortError' });
    expect(new ApiError(429, 'RATE_LIMITED', 'Slow down').status).toBe(429);
  });
});
