import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { integrationDatabase } from './integration-helpers.js';
import { startServer } from '../src/server.js';
import { createLogger } from '../src/logger.js';
import { seedDemoRoles, seedDemoSeller } from '../prisma/seed.js';

describe('UNLOSS Final MVP End-to-End Directive Workflow', () => {
  const { prisma, config } = integrationDatabase();
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    // Start runtime
    runtime = await startServer({ ...config, port: 0 }, createLogger(() => {}), prisma);
    const port = (runtime.server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed demo seller and roles
    const seller = await seedDemoSeller(prisma, {
      ...process.env,
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      SEED_SELLER_EMAIL: 'seller@unloss.local',
      SEED_SELLER_PASSWORD: 'SampleSellerPassword123!',
    });
    await seedDemoRoles(prisma, process.env, seller);
  });

  afterAll(async () => {
    await runtime?.shutdown();
    await prisma.$disconnect();
  });

  // Helper for cookie-aware fetch
  function makeSessionClient() {
    let cookie = '';
    return async (path: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers);
      headers.set('Origin', config.appOrigin);
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (cookie) {
        headers.set('Cookie', cookie);
      }
      const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        cookie = setCookie.split(';')[0]!;
      }
      return res;
    };
  }

  it('completes the exact 9-step UNLOSS parcel-verification product lifecycle', async () => {
    const sellerClient = makeSessionClient();
    const deliveryClient = makeSessionClient();
    const customerClient = makeSessionClient();
    const adminClient = makeSessionClient();

    // Sign in to roles via demo-switch
    const sellerLogin = await (await sellerClient('/api/auth/demo-switch', { method: 'POST', body: JSON.stringify({ role: 'SELLER' }) })).json();
    expect(sellerLogin.seller).toBeDefined();
    const sellerId = sellerLogin.seller.id;
    const initialReward = await (await sellerClient('/api/rewards/summary')).json();

    const deliveryLogin = await (await deliveryClient('/api/auth/demo-switch', { method: 'POST', body: JSON.stringify({ role: 'DELIVERY' }) })).json();
    expect(deliveryLogin.user).toBeDefined();
    const deliveryUserId = deliveryLogin.user.id;

    const customerLogin = await (await customerClient('/api/auth/demo-switch', { method: 'POST', body: JSON.stringify({ role: 'CUSTOMER' }) })).json();
    expect(customerLogin.user).toBeDefined();

    const adminLogin = await (await adminClient('/api/auth/demo-switch', { method: 'POST', body: JSON.stringify({ role: 'ADMIN' }) })).json();
    expect(adminLogin.user).toBeDefined();

    // -------------------------------------------------------------------------
    // STEP 1: Seller creates a product — enters name, saves persistent draft & receives dual QR codes
    // -------------------------------------------------------------------------
    const draftRes = await sellerClient('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({ productName: 'Mechanical Ergonomic Keyboard', quantity: 2 }),
    });
    expect(draftRes.status).toBe(201);
    const draftData = await draftRes.json();
    expect(draftData.draft.id).toBeDefined();
    expect(draftData.product.name).toBe('Mechanical Ergonomic Keyboard');
    expect(draftData.qr.deliveryUrl).toContain('/draft/delivery/');
    expect(draftData.qr.customerUrl).toContain('/draft/customer/');
    expect(draftData.status).toBe('AWAITING_ACTIVATION');
    const draftId = draftData.draft.id;

    // Both draft QR codes are immediately scannable public preview endpoints
    const deliveryDraftToken = draftData.qr.deliveryUrl.split('/').pop()!;
    const customerDraftToken = draftData.qr.customerUrl.split('/').pop()!;

    const pubDeliveryRes = await fetch(`${baseUrl}/api/drafts/public/${deliveryDraftToken}`);
    expect(pubDeliveryRes.status).toBe(200);
    const pubDeliveryData = await pubDeliveryRes.json();
    expect(pubDeliveryData.status).toBe('AWAITING_ACTIVATION');
    expect(pubDeliveryData.purpose).toBe('DELIVERY');

    const pubCustomerRes = await fetch(`${baseUrl}/api/drafts/public/${customerDraftToken}`);
    expect(pubCustomerRes.status).toBe(200);
    const pubCustomerData = await pubCustomerRes.json();
    expect(pubCustomerData.status).toBe('AWAITING_ACTIVATION');
    expect(pubCustomerData.purpose).toBe('CUSTOMER');

    // -------------------------------------------------------------------------
    // STEP 2: Seller completes shipment details & satisfies funding requirements
    // -------------------------------------------------------------------------
    const updateRes = await sellerClient(`/api/drafts/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        recipientName: 'Arjun Verma',
        recipientPhone: '+919876543210',
        addressLine1: '402 Koramangala 4th Block',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560034',
        courier: 'BlueDart Express',
        trackingNumber: 'BLU-9028471',
      }),
    });
    expect(updateRes.status).toBe(200);

    // Top up reward budget to satisfy funding reservation requirement (₹5 reward + ₹1 fee)
    const checkoutRes = await sellerClient('/api/seller/funding/checkout', {
      method: 'POST',
      body: JSON.stringify({ amountPaise: 1000 }), // ₹10
    });
    expect(checkoutRes.status).toBe(200);
    const checkoutData = await checkoutRes.json();

    const captureRes = await sellerClient('/api/seller/funding/capture', {
      method: 'POST',
      body: JSON.stringify({
        providerOrderId: checkoutData.providerOrderId,
        providerPaymentId: `pay_sim_${Date.now()}`,
      }),
    });
    expect(captureRes.status).toBe(200);

    // Activate draft into live order
    const activateRes = await sellerClient(`/api/drafts/${draftId}/activate`, { method: 'POST' });
    expect(activateRes.status).toBe(201);
    const activateData = await activateRes.json();
    const liveOrderId = activateData.orderId;
    expect(liveOrderId).toBeDefined();
    expect(activateData.qr.deliveryUrl).toContain(`/delivery/`);
    expect(activateData.qr.customerUrl).toContain(`/customer/`);

    // Reserve reward funds for activated order
    const reserveRes = await sellerClient(`/api/orders/${liveOrderId}/fund-reserve`, { method: 'POST' });
    expect(reserveRes.status).toBe(201);
    const reserveData = await reserveRes.json();
    expect(reserveData.reservation.status).toBe('RESERVED');
    expect(reserveData.reservation.totalPaise).toBe(600);

    const liveDeliveryToken = activateData.qr.deliveryUrl.split('/').pop()!;
    const liveCustomerToken = activateData.qr.customerUrl.split('/').pop()!;

    // -------------------------------------------------------------------------
    // STEP 3: Courier update arrives — tracking event activates delivery workflow
    // -------------------------------------------------------------------------
    // Register shipment
    await sellerClient(`/api/orders/${liveOrderId}/shipment`, {
      method: 'POST',
      body: JSON.stringify({ courier: 'BlueDart Express', trackingNumber: 'BLU-9028471' }),
    });

    // Seller transitions to READY_FOR_DISPATCH and OUT_FOR_DELIVERY
    await sellerClient(`/api/orders/${liveOrderId}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ toStatus: 'READY_FOR_DISPATCH', reasonCode: null, note: null }),
    });
    const dispatchRes = await sellerClient(`/api/orders/${liveOrderId}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ toStatus: 'OUT_FOR_DELIVERY', reasonCode: null, note: null }),
    });
    expect(dispatchRes.status).toBe(200);

    // Courier webhook simulates live carrier milestone
    const webhookRes = await fetch(`${baseUrl}/api/integrations/aftership/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({
        trackingNumber: 'BLU-9028471',
        status: 'OutForDelivery',
        message: 'Courier out for delivery in Koramangala hub',
        occurredAt: new Date().toISOString(),
        providerEventId: `evt_${Date.now()}`,
      }),
    });
    expect(webhookRes.status).toBe(200);

    // -------------------------------------------------------------------------
    // STEP 4: Delivery person claims the parcel — approval enforced by backend
    // -------------------------------------------------------------------------
    const claimRes = await deliveryClient(`/api/orders/${liveOrderId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ latitude: 12.9352, longitude: 77.6245, accuracyMeters: 8.5 }),
    });
    expect(claimRes.status).toBe(201);
    const claimData = await claimRes.json();
    const claimId = claimData.claim.id;
    expect(claimData.claim.status).toBe('PENDING');

    // Seller approves the delivery claim
    const approveClaimRes = await sellerClient(`/api/seller/claims/${claimId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ action: 'APPROVE' }),
    });
    expect(approveClaimRes.status).toBe(200);
    expect((await approveClaimRes.json()).claim.status).toBe('APPROVED');

    // -------------------------------------------------------------------------
    // STEP 5: Delivery person scans & records evidence
    // -------------------------------------------------------------------------
    const deliveryPreview = await (await fetch(`${baseUrl}/api/delivery/${liveDeliveryToken}`)).json();
    expect(deliveryPreview.status).toBe('OUT_FOR_DELIVERY');
    expect(deliveryPreview.mode).toBe('demo');

    // Attempting handoff before customer OTP acceptance is strictly rejected (HTTP 409)
    const prematureHandoff = await fetch(`${baseUrl}/api/delivery/${liveDeliveryToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ outcome: 'DELIVERED_VERIFIED', reasonCode: null, note: null }),
    });
    expect(prematureHandoff.status).toBe(409);

    // -------------------------------------------------------------------------
    // STEP 6: Customer verifies receipt — fresh attempt-bound OTP confirms acceptance
    // -------------------------------------------------------------------------
    const customerPreview = await (await fetch(`${baseUrl}/api/customer/${liveCustomerToken}`)).json();
    expect(customerPreview.status).toBe('OUT_FOR_DELIVERY');

    // Request customer OTP
    const otpChallengeRes = await fetch(`${baseUrl}/api/customer/${liveCustomerToken}/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
    });
    expect([200, 201, 202]).toContain(otpChallengeRes.status);
    const otpChallenge = await otpChallengeRes.json();
    expect(otpChallenge.challengeId).toBeDefined();
    expect(otpChallenge.devCode).toBeDefined();

    // Verify 6-digit OTP code
    const otpVerifyRes = await fetch(`${baseUrl}/api/customer/${liveCustomerToken}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ challengeId: otpChallenge.challengeId, code: otpChallenge.devCode }),
    });
    expect(otpVerifyRes.status).toBe(200);
    const proof = await otpVerifyRes.json();
    expect(proof.verificationToken).toBeDefined();

    // Customer accepts parcel
    const decideRes = await fetch(`${baseUrl}/api/customer/${liveCustomerToken}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.appOrigin,
        'X-Customer-Verification': proof.verificationToken,
      },
      body: JSON.stringify({
        verificationToken: proof.verificationToken,
        action: 'ACCEPT',
        reasonCode: null,
        note: null,
      }),
    });
    expect([200, 201]).toContain(decideRes.status);

    // -------------------------------------------------------------------------
    // STEP 7: Order completes — backend validates all conditions, persists final state
    // -------------------------------------------------------------------------
    const finalHandoffRes = await fetch(`${baseUrl}/api/delivery/${liveDeliveryToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ outcome: 'DELIVERED_VERIFIED', reasonCode: null, note: 'Handoff confirmed in person' }),
    });
    expect([200, 201]).toContain(finalHandoffRes.status);
    const finalOrder = (await finalHandoffRes.json()).order;
    expect(finalOrder.status).toBe('DELIVERED_VERIFIED');

    // -------------------------------------------------------------------------
    // STEP 8: Live dashboards update — SSE poll endpoint reflects final status
    // -------------------------------------------------------------------------
    const livePollRes = await sellerClient('/api/events/poll');
    expect(livePollRes.status).toBe(200);
    const pollData = await livePollRes.json();
    const completedEvent = pollData.items.find((e: any) => e.orderId === liveOrderId && e.status === 'DELIVERED_VERIFIED');
    expect(completedEvent).toBeDefined();

    // -------------------------------------------------------------------------
    // STEP 9: Reward is credited once — ₹5 enters internal ledger
    // -------------------------------------------------------------------------
    const rewardRes = await sellerClient('/api/rewards/summary');
    expect(rewardRes.status).toBe(200);
    const rewardSummary = await rewardRes.json();
    expect(rewardSummary.totalPaise - initialReward.totalPaise).toBe(500); // Exactly ₹5 increment
    expect(rewardSummary.creditCount - initialReward.creditCount).toBe(1);

    // Verify exact persistent ledger row for this verified order
    const orderLedger = await prisma.ledgerEntry.findMany({ where: { orderId: liveOrderId } });
    expect(orderLedger).toHaveLength(1);
    expect(orderLedger[0]!.amountPaise).toBe(500);
    expect(orderLedger[0]!.currency).toBe('INR');
    expect(orderLedger[0]!.type).toBe('DELIVERY_REWARD');

    // Replay of handoff is rejected (HTTP 404/409 - already completed and token revoked)
    const replayRes = await fetch(`${baseUrl}/api/delivery/${liveDeliveryToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ outcome: 'DELIVERED_VERIFIED', reasonCode: null, note: null }),
    });
    expect([404, 409]).toContain(replayRes.status);

    // Payout worker creates scheduled batch for eligible earnings
    const payoutRes = await adminClient('/api/admin/payouts/run', { method: 'POST' });
    expect(payoutRes.status).toBe(200);
    const payoutBatch = await payoutRes.json();
    expect(payoutBatch.batch.status).toBe('SCHEDULED');
    expect(payoutBatch.note).toContain('Weekly payout scheduled for Monday 10:00 AM IST');
  });
});
