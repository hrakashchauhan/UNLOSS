import 'express-session';

declare module 'express-session' {
  interface SessionData {
    sellerId?: string;
    userId?: string;
    sessionExpiresAt?: number;
    credentialVersion?: string;
  }
}
