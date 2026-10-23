import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workflowFixture } from './workflow-fixture.js';

describe('Phase 2: Seller Dashboard & Dual QR Generator Integration Tests', () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;

  beforeAll(async () => {
    f = await workflowFixture();
  });

  afterAll(async () => {
    await f?.close();
  });

  it('immediately creates a persistent draft with distinct delivery and customer QR tokens', async () => {
    const res = await f.request('/drafts', {
      productName: 'Mechanical Ergonomic Keyboard',
      quantity: 3,
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.draft.id).toBeDefined();
    expect(body.product.name).toBe('Mechanical Ergonomic Keyboard');
    expect(body.status).toBe('AWAITING_ACTIVATION');

    // Dual QR codes must be distinct
    expect(body.qr.deliveryUrl).toMatch(/\/draft\/delivery\/[A-Za-z0-9_-]{43}$/);
    expect(body.qr.customerUrl).toMatch(/\/draft\/customer\/[A-Za-z0-9_-]{43}$/);
    expect(body.qr.deliveryUrl).not.toBe(body.qr.customerUrl);

    // Tokens must be persisted in DB
    const tokens = await f.prisma.draftQrToken.findMany({ where: { draftId: body.draft.id } });
    expect(tokens).toHaveLength(2);
    const purposes = tokens.map(t => t.purpose);
    expect(purposes).toContain('DELIVERY');
    expect(purposes).toContain('CUSTOMER');
    expect(tokens.every(t => !t.revokedAt)).toBe(true);
  });

  it('serves scannable pre-dispatch public preview for both draft QR tokens', async () => {
    const createRes = await f.request('/drafts', {
      productName: 'Wireless Noise Canceling Headphones',
      quantity: 1,
    });
    const { qr } = await createRes.json();
    const deliveryToken = qr.deliveryUrl.split('/').pop()!;
    const customerToken = qr.customerUrl.split('/').pop()!;

    // Public scan for delivery draft QR
    const delRes = await fetch(`${f.server.url}/api/drafts/public/${deliveryToken}`);
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.status).toBe('AWAITING_ACTIVATION');
    expect(delData.purpose).toBe('DELIVERY');
    expect(delData.productName).toBe('Wireless Noise Canceling Headphones');
    expect(delData.quantity).toBe(1);
    expect(delData.hasRecipient).toBe(false);

    // Public scan for customer draft QR
    const custRes = await fetch(`${f.server.url}/api/drafts/public/${customerToken}`);
    expect(custRes.status).toBe(200);
    const custData = await custRes.json();
    expect(custData.status).toBe('AWAITING_ACTIVATION');
    expect(custData.purpose).toBe('CUSTOMER');
    expect(custData.productName).toBe('Wireless Noise Canceling Headphones');
    expect(custData.hasRecipient).toBe(false);
  });

  it('updates draft with recipient and shipping details', async () => {
    const createRes = await f.request('/drafts', {
      productName: 'Organic Green Tea 500g',
      quantity: 2,
    });
    const { draft, qr } = await createRes.json();

    const patchRes = await f.request(`/drafts/${draft.id}`, {
      recipientName: 'Priya Sharma',
      recipientPhone: '+919876543210',
      addressLine1: 'Flat 302, Palm Heights',
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      courier: 'Delhivery',
      trackingNumber: 'DLV-482910',
    }, true, {}, 'PATCH');

    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.draft.recipientName).toBe('Priya Sharma');
    expect(patched.draft.courier).toBe('Delhivery');
    expect(patched.draft.trackingNumber).toBe('DLV-482910');

    // Public scan now reflects recipient details
    const deliveryToken = qr.deliveryUrl.split('/').pop()!;
    const checkRes = await fetch(`${f.server.url}/api/drafts/public/${deliveryToken}`);
    const checkData = await checkRes.json();
    expect(checkData.hasRecipient).toBe(true);
  });

  it('duplicates draft with a fresh pair of distinct QR tokens', async () => {
    const createRes = await f.request('/drafts', {
      productName: 'Handcrafted Ceramic Mug',
      quantity: 4,
    });
    const { draft: origDraft, qr: origQr } = await createRes.json();

    const dupRes = await f.request(`/drafts/${origDraft.id}/duplicate`, {});
    expect(dupRes.status).toBe(201);
    const dupData = await dupRes.json();

    expect(dupData.draft.id).not.toBe(origDraft.id);
    expect(dupData.draft.productId).toBe(origDraft.productId);
    expect(dupData.draft.quantity).toBe(origDraft.quantity);

    // Duplicated QR tokens must be different from original
    expect(dupData.qr.deliveryUrl).not.toBe(origQr.deliveryUrl);
    expect(dupData.qr.customerUrl).not.toBe(origQr.customerUrl);
  });

  it('reprints draft and restores verified QR URLs', async () => {
    const createRes = await f.request('/drafts', {
      productName: 'Leather Laptop Sleeve 14-inch',
      quantity: 1,
    });
    const { draft, qr } = await createRes.json();

    const reprintRes = await f.request(`/drafts/${draft.id}/reprint`, {});
    expect(reprintRes.status).toBe(200);
    const reprintData = await reprintRes.json();
    expect(reprintData.draftId).toBe(draft.id);
    expect(reprintData.qr.deliveryUrl).toBe(qr.deliveryUrl);
    expect(reprintData.qr.customerUrl).toBe(qr.customerUrl);
  });

  it('revokes draft QR tokens and causes subsequent scans to be rejected', async () => {
    const createRes = await f.request('/drafts', {
      productName: 'Bluetooth Portable Speaker',
      quantity: 1,
    });
    const { draft, qr } = await createRes.json();
    const deliveryToken = qr.deliveryUrl.split('/').pop()!;

    // Initial scan succeeds
    const beforeRes = await fetch(`${f.server.url}/api/drafts/public/${deliveryToken}`);
    expect(beforeRes.status).toBe(200);

    // Revoke
    const revokeRes = await f.request(`/drafts/${draft.id}/revoke`, {});
    expect(revokeRes.status).toBe(200);
    const revokeData = await revokeRes.json();
    expect(revokeData.status).toBe('REVOKED');

    // Public scan now fails with 404 TOKEN_INVALID
    const afterRes = await fetch(`${f.server.url}/api/drafts/public/${deliveryToken}`);
    expect(afterRes.status).toBe(404);
    const errBody = await afterRes.json();
    expect(errBody.error.code).toBe('TOKEN_INVALID');
  });

  it('activates draft into live order with dual active tokens and sets redirect on draft tokens', async () => {
    // 1. Create draft
    const createRes = await f.request('/drafts', {
      productName: 'Standing Desk Converter',
      quantity: 1,
    });
    const { draft, qr } = await createRes.json();
    const deliveryDraftToken = qr.deliveryUrl.split('/').pop()!;

    // 2. Activating without recipient details fails
    const prematureActivate = await f.request(`/drafts/${draft.id}/activate`, {});
    expect(prematureActivate.status).toBe(400);

    // 3. Complete recipient details
    await f.request(`/drafts/${draft.id}`, {
      recipientName: 'Kavita Rao',
      recipientPhone: '+919123456789',
      addressLine1: 'Villa 12, Palm Meadows',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560066',
      courier: 'BlueDart Express',
      trackingNumber: 'BLU-8492019',
    }, true, {}, 'PATCH');

    // 4. Activate draft
    const activateRes = await f.request(`/drafts/${draft.id}/activate`, {});
    expect(activateRes.status).toBe(201);
    const activateData = await activateRes.json();
    expect(activateData.orderId).toBeDefined();
    expect(activateData.qr.deliveryUrl).toMatch(/\/delivery\/[A-Za-z0-9_-]{43}$/);
    expect(activateData.qr.customerUrl).toMatch(/\/customer\/[A-Za-z0-9_-]{43}$/);

    // Check order status in DB
    const liveOrder = await f.prisma.order.findUnique({ where: { id: activateData.orderId } });
    expect(liveOrder?.status).toBe('CREATED');
    expect(liveOrder?.customerName).toBe('Kavita Rao');

    // 5. Public scan on original draft QR now returns ACTIVATED with redirect
    const scanDraftRes = await fetch(`${f.server.url}/api/drafts/public/${deliveryDraftToken}`);
    expect(scanDraftRes.status).toBe(200);
    const scanDraftData = await scanDraftRes.json();
    expect(scanDraftData.status).toBe('ACTIVATED');
    expect(scanDraftData.orderId).toBe(activateData.orderId);
    expect(scanDraftData.redirectUrl).toMatch(/\/delivery\//);
  });

  it('lists saved drafts with decrypted QR URLs for seller reopening', async () => {
    const listRes = await f.request('/drafts');
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(Array.isArray(listData.items)).toBe(true);
    expect(listData.items.length).toBeGreaterThan(0);
    const first = listData.items[0];
    expect(first.product).toBeDefined();
    expect(first.qr).toBeDefined();
  });
});
