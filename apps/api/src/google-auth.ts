import { OAuth2Client } from 'google-auth-library';
import { err } from './http.js';

const client = new OAuth2Client();
export async function verifyGoogleCredential(credential: string, audience: string | undefined) {
  if (!audience) throw err('AUTH_PROVIDER_UNAVAILABLE', 'Google sign-in is not configured', 503);
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) throw new Error('Unverified identity');
    return { subject: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email };
  } catch {
    throw err('INVALID_CREDENTIALS', 'Google identity could not be verified', 401);
  }
}
