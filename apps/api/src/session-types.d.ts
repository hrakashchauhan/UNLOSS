import 'express-session';

declare module 'express-session' {
  interface SessionData {
    sellerId?: string;
    sessionExpiresAt?: number;
    credentialVersion?: string;
  }
}
