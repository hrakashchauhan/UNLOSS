import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { demoWorkflowApi as api, partnerStep, resetDemo } from './store';

beforeEach(resetDemo);
afterEach(() => vi.useRealTimers());
function approve() { partnerStep('CONSENT'); partnerStep('CONTACT'); partnerStep('DOCUMENT'); partnerStep('SUBMIT'); partnerStep('APPROVE', 'Synthetic evidence consistent'); partnerStep('ACTIVATE'); }
async function acceptance() { const challenge = await api.requestOtp(''); const proof = await api.verifyOtp('', challenge.challengeId, '246810'); await api.decide('', proof.verificationToken, { action: 'ACCEPT', reasonCode: null, note: null }); return proof; }
const handoff = { outcome: 'DELIVERED_VERIFIED' as const, reasonCode: null, note: null };

describe('isolated synthetic workflow rules (not backend security tests)', () => {
  it('requires consent and rejects out-of-order review/activation', () => {
    expect(() => partnerStep('CONTACT')).toThrow('Consent');
    partnerStep('CONSENT');
    expect(() => partnerStep('APPROVE', 'reason')).toThrow('not permitted');
    expect(() => partnerStep('ACTIVATE')).toThrow('approval');
  });
  it('requires reviewer reasons and supports revision after rejection', () => {
    partnerStep('CONSENT'); partnerStep('CONTACT'); partnerStep('DOCUMENT'); partnerStep('SUBMIT');
    expect(() => partnerStep('REJECT')).toThrow('reason');
    partnerStep('REJECT', 'Synthetic mismatch'); partnerStep('RETRY'); partnerStep('DOCUMENT'); partnerStep('SUBMIT'); partnerStep('APPROVE', 'Reviewed');
  });
  it('blocks inactive and unverified partners and requires customer acceptance', async () => {
    await expect(api.deliver('', handoff)).rejects.toMatchObject({ status: 403 });
    approve(); await expect(api.deliver('', handoff)).rejects.toThrow('acceptance');
    partnerStep('DEACTIVATE'); await expect(api.deliver('', handoff)).rejects.toMatchObject({ status: 403 });
  });
  it('enforces code correctness, expiry, and resend cooldown', async () => {
    vi.useFakeTimers();
    const challenge = await api.requestOtp('');
    await expect(api.requestOtp('')).rejects.toMatchObject({ status: 429 });
    await expect(api.verifyOtp('', challenge.challengeId, '000000')).rejects.toThrow('Incorrect');
    vi.advanceTimersByTime(300_001);
    await expect(api.verifyOtp('', challenge.challengeId, '246810')).rejects.toThrow('expired');
    await expect(api.requestOtp('')).resolves.toHaveProperty('challengeId');
  });
  it('exhausts attempts and consumes the demo proof after a decision', async () => {
    const challenge = await api.requestOtp('');
    for (let attempt = 0; attempt < 5; attempt++) await expect(api.verifyOtp('', challenge.challengeId, '000000')).rejects.toThrow();
    await expect(api.verifyOtp('', challenge.challengeId, '246810')).rejects.toThrow('exhausted');
    resetDemo(); const proof = await acceptance();
    await expect(api.decide('', proof.verificationToken, { action: 'ACCEPT', reasonCode: null, note: null })).rejects.toMatchObject({ status: 401 });
  });
  it('records acceptance without completing delivery; repeated eligible handoff stays completed', async () => {
    approve(); await acceptance();
    expect((await api.preview('customer', '')).status).toBe('OUT_FOR_DELIVERY');
    expect((await api.deliver('', handoff)).order.status).toBe('DELIVERED_VERIFIED');
    expect((await api.deliver('', handoff)).order.status).toBe('DELIVERED_VERIFIED');
    expect((await api.preview('delivery', '')).permittedOutcomes).toEqual([]);
    await expect(api.requestOtp('')).rejects.toMatchObject({ status: 404 });
  });
  it.each(['REJECT', 'REQUEST_REDELIVERY'] as const)('records %s without a delivery credit or further eligible customer actions', async action => {
    const challenge = await api.requestOtp(''), proof = await api.verifyOtp('', challenge.challengeId, '246810');
    await api.decide('', proof.verificationToken, { action, reasonCode: action === 'REJECT' ? 'PACKAGE_DAMAGED' : 'CUSTOMER_REQUESTED_REDELIVERY', note: null });
    expect((await api.preview('customer', '')).allowedActions).toEqual([]);
  });
});
