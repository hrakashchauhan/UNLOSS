import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { verifyGoogleCredential } from '../src/google-auth.js';

afterEach(() => vi.restoreAllMocks());
describe('verified Google identity', () => {
  it('fails closed without a configured audience', async () => {
    await expect(verifyGoogleCredential('token', undefined)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects invalid signatures and expired tokens reported by Google library', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockRejectedValue(new Error('invalid signature'));
    await expect(verifyGoogleCredential('forged', 'client-id')).rejects.toMatchObject({ status: 401 });
  });
  it('requires a verified email even on a signed token', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({ getPayload: () => ({ sub: 'subject', email: 'a@example.com', email_verified: false }) } as never);
    await expect(verifyGoogleCredential('token', 'client-id')).rejects.toMatchObject({ status: 401 });
  });
  it('checks the intended audience and returns the stable subject', async () => {
    const verify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({ getPayload: () => ({ sub: 'subject', email: 'A@example.com', email_verified: true, name: 'A' }) } as never);
    await expect(verifyGoogleCredential('token', 'client-id')).resolves.toEqual({ subject: 'subject', email: 'a@example.com', name: 'A' });
    expect(verify).toHaveBeenCalledWith({ idToken: 'token', audience: 'client-id' });
  });
});
