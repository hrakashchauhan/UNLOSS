import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Express, RequestHandler, Response } from 'express';
import type { Config } from './config.js';
import { err } from './http.js';
import { verifyGoogleCredential } from './google-auth.js';
import { hashToken } from './rules.js';
import { PrismaSessionStore, SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from './sessions.js';
import type { createRateLimits } from './rate-limits.js';

export type PublicSeller = { id: string; email: string; name: string };
export type AuthUser = { id: string; name: string; email: string | null; phone: string | null; roles: string[]; deliveryStatus?: string };
export const currentSeller = (res: Response): PublicSeller => res.locals.seller as PublicSeller;
export const currentUser = (res: Response): AuthUser | undefined => res.locals.authUser as AuthUser | undefined;
// Equal-cost comparison for unknown emails. This is a random dummy, never an account credential.
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('base64url'), 12);
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
});

export function requireSeller(prisma: PrismaClient, config: Config): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.session?.sellerId || !req.session.sessionExpiresAt || req.session.sessionExpiresAt <= Date.now()) {
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
        throw err('UNAUTHENTICATED', 'Sign in required', 401);
      }
      const seller = await prisma.seller.findUnique({ where: { id: req.session.sellerId } });
      if (!seller || hashToken(seller.passwordHash) !== req.session.credentialVersion) {
        await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
        throw err('UNAUTHENTICATED', 'Sign in required', 401);
      }
      res.locals.seller = { id: seller.id, email: seller.email, name: seller.name } satisfies PublicSeller;
      next();
    } catch (error) { next(error); }
  };
}

export function requireAnySession(prisma: PrismaClient, _config: Config): RequestHandler {
  return async (req, res, next) => {
    try {
      if (req.session?.sellerId && req.session.sessionExpiresAt && req.session.sessionExpiresAt > Date.now()) {
        const seller = await prisma.seller.findUnique({ where: { id: req.session.sellerId } });
        if (seller && hashToken(seller.passwordHash) === req.session.credentialVersion) {
          res.locals.seller = { id: seller.id, email: seller.email, name: seller.name } satisfies PublicSeller;
        }
      }
      if (req.session?.userId && req.session.sessionExpiresAt && req.session.sessionExpiresAt > Date.now()) {
        const user = await prisma.user.findUnique({ where: { id: req.session.userId }, include: { memberships: true, deliveryProfile: true } });
        if (user && user.status === 'ACTIVE' && hashToken(user.passwordHash || 'google-session') === req.session.credentialVersion) {
          res.locals.authUser = { id: user.id, name: user.name, email: user.email, phone: user.phone, roles: user.memberships.filter(m => m.status === 'ACTIVE').map(m => m.role), deliveryStatus: user.deliveryProfile?.reviewStatus } satisfies AuthUser;
        }
      }
      next();
    } catch (error) { next(error); }
  };
}

export function requireRole(roles: string[]): RequestHandler {
  return (req, res, next) => {
    const user = currentUser(res);
    if (!user) throw err('UNAUTHENTICATED', 'Sign in required', 401);
    if (!roles.some(r => user.roles.includes(r))) throw err('FORBIDDEN', 'Insufficient permissions', 403);
    next();
  };
}

export function assertRoleRequestAllowed(role: string) {
  if (!['CUSTOMER', 'DELIVERY'].includes(role)) {
    throw err('ROLE_ASSIGNMENT_RESTRICTED', 'Seller access must be authorized by an administrator. Choose Customer or submit a delivery application for review.', 403);
  }
}

export function registerAuthRoutes(app: Express, prisma: PrismaClient, config: Config, store: PrismaSessionStore, limits: ReturnType<typeof createRateLimits>) {
  const validate: RequestHandler = (req, _res, next) => {
    try { req.body = credentials.parse(req.body); next(); } catch (error) { next(error); }
  };
  app.post('/api/auth/login', limits.loginIp, validate, limits.loginAccount, async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const seller = await prisma.seller.findUnique({ where: { email } });
    const matchedSeller = seller ? await bcrypt.compare(password, seller.passwordHash) : false;

    let user: any = null;
    let matchedUser = false;

    if (!matchedSeller) {
      user = await prisma.user.findFirst({
        where: { OR: [{ email }, { phone: email }] },
        include: { memberships: true, deliveryProfile: true },
      });
      if (user?.passwordHash) {
        matchedUser = await bcrypt.compare(password, user.passwordHash);
      }
    } else if (seller?.userId) {
      user = await prisma.user.findUnique({
        where: { id: seller.userId },
        include: { memberships: true, deliveryProfile: true },
      });
    }

    if (!matchedSeller && !matchedUser) {
      if (!seller && !user) {
        await bcrypt.compare(password, dummyHash);
      }
      throw err('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
    }

    try {
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      if (matchedSeller && seller) {
        req.session.sellerId = seller.id;
        req.session.credentialVersion = hashToken(seller.passwordHash);
        if (user) req.session.userId = user.id;
      } else if (matchedUser && user) {
        req.session.userId = user.id;
        req.session.credentialVersion = hashToken(user.passwordHash || 'user-credential');
        const userSeller = await prisma.seller.findFirst({ where: { userId: user.id } });
        if (userSeller) req.session.sellerId = userSeller.id;
      }
      req.session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
      req.session.cookie.expires = new Date(req.session.sessionExpiresAt);
      await store.issue(req.sessionID, req.session);
      // Wait for persistence verification before success/cookie; response-end errors are too late.
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    } catch (error) {
      if (req.session) await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      throw error;
    }
    res.json({
      seller: seller ? { id: seller.id, email: seller.email, name: seller.name } : null,
      ...(user ? {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          roles: user.memberships ? user.memberships.filter((m: any) => m.status === 'ACTIVE').map((m: any) => m.role) : [],
          deliveryStatus: user.deliveryProfile?.reviewStatus,
        },
      } : {}),
      mode: config.demo ? 'demo' : 'manual',
    });
  });

  const authAny = requireAnySession(prisma, config);
  const requireAuth: RequestHandler = (_req, res, next) => {
    if (!res.locals.seller && !res.locals.authUser) throw err('UNAUTHENTICATED', 'Sign in required', 401);
    next();
  };

  app.get('/api/auth/me', authAny, requireAuth, (_req, res) => {
    const seller = (res.locals as any).seller || null;
    const user = (res.locals as any).authUser || null;
    res.json({
      seller,
      user,
      mode: config.demo ? 'demo' : 'manual',
    });
  });
  app.post('/api/auth/logout', authAny, requireAuth, async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
    res.status(204).end();
  });

  // Shared identity/session enrichment
  app.get('/api/auth/session', authAny, async (_req, res) => {
    const seller = (res.locals as any).seller || null;
    const authUser = (res.locals as any).authUser || null;
    res.json({
      seller,
      user: authUser || null,
      mode: config.demo ? 'demo' : 'manual',
    });
  });

  // Registration for delivery/customer/seller roles
  app.post('/api/auth/register', limits.loginIp, async (req, res) => {
    const v = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      phone: z.string().trim().min(10).max(20).optional(),
      password: z.string().min(6).max(72),
      role: z.enum(['DELIVERY', 'CUSTOMER', 'SELLER']),
      employer: z.string().trim().max(100).optional(),
      deliveryReference: z.string().trim().max(100).optional(),
      addressLine1: z.string().trim().max(200).optional(),
      city: z.string().trim().max(100).optional(),
      state: z.string().trim().max(100).optional(),
      postalCode: z.string().trim().max(20).optional(),
    }).refine(data => data.email || data.phone, { message: 'Either email or phone is required' }).parse(req.body);

    assertRoleRequestAllowed(v.role);

    if (v.email) {
      const existing = await prisma.user.findUnique({ where: { email: v.email } });
      if (existing) throw err('CONFLICT', 'An account with this email already exists', 409);
    }
    if (v.phone) {
      const existing = await prisma.user.findUnique({ where: { phone: v.phone } });
      if (existing) throw err('CONFLICT', 'An account with this phone already exists', 409);
    }

    const passwordHash = await bcrypt.hash(v.password, 12);
    const { user: result, seller } = await prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: {
          name: v.name,
          email: v.email || null,
          phone: v.phone || null,
          passwordHash,
          status: 'ACTIVE',
          memberships: { create: v.role === 'DELIVERY'
            ? [{ role: 'CUSTOMER', status: 'ACTIVE' }, { role: 'DELIVERY', status: 'PENDING' }]
            : { role: 'CUSTOMER', status: 'ACTIVE' } },
          ...(v.role === 'DELIVERY' ? {
            deliveryProfile: {
              create: {
                employer: v.employer || 'Independent Courier',
                deliveryReference: v.deliveryReference || `REF-${randomBytes(4).toString('hex').toUpperCase()}`,
                reviewStatus: 'PENDING',
                phoneVerifiedAt: null,
              },
            },
          } : {}),
          customerProfile: { create: { defaultName: v.name, addressLine1: v.addressLine1 || null, city: v.city || null, state: v.state || null, postalCode: v.postalCode || null } },
        },
        include: { memberships: true, deliveryProfile: true },
      });

      let sellerRecord: any = null;
      if (v.role === 'SELLER') {
        sellerRecord = await tx.seller.create({
          data: {
            id: user.id,
            email: v.email || `${user.id}@seller.unloss.local`,
            name: v.name,
            passwordHash,
            userId: user.id,
          },
        });
      }

      return { user, seller: sellerRecord };
    });

    // Automatically establish session upon registration
    try {
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.userId = result.id;
      req.session.credentialVersion = hashToken(result.passwordHash || 'user-credential');
      if (seller) {
        req.session.sellerId = seller.id;
      }
      req.session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
      req.session.cookie.expires = new Date(req.session.sessionExpiresAt);
      await store.issue(req.sessionID, req.session);
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    } catch {
      if (req.session) await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      throw err('SESSION_UNAVAILABLE', 'Account created, but sign-in failed. Please sign in again.', 503);
    }

    res.status(201).json({
      seller: seller ? { id: seller.id, email: seller.email, name: seller.name } : null,
      user: {
        id: result.id,
        name: result.name,
        email: result.email,
        phone: result.phone,
        roles: result.memberships.filter(m => m.status === 'ACTIVE').map(m => m.role),
        deliveryStatus: result.deliveryProfile?.reviewStatus,
      },
      mode: config.demo ? 'demo' : 'manual',
    });
  });

  // Google Authentication endpoint (OAuth / One-tap sign-in)
  app.post('/api/auth/google', limits.loginIp, async (req, res) => {
    const input = z.object({
      credential: z.string().min(1).max(10000),
      role: z.enum(['SELLER', 'DELIVERY', 'CUSTOMER']).default('CUSTOMER'),
    }).parse(req.body);
    assertRoleRequestAllowed(input.role);
    const identity = await verifyGoogleCredential(input.credential, config.googleClientId);
    const v = { email: identity.email, name: identity.name, role: input.role };

    let user: any = await prisma.user.findUnique({
      where: { googleSubject: identity.subject },
      include: { memberships: true, deliveryProfile: true },
    });

    let seller = await prisma.seller.findUnique({ where: { email: v.email } });

    if (!user) {
      const existingEmail = await prisma.user.findUnique({ where: { email: v.email } });
      if (existingEmail || seller) throw err('ACCOUNT_LINK_REQUIRED', 'This email already has an account. Sign in with your password.', 409);
      const dummyPassword = await bcrypt.hash(randomBytes(16).toString('hex'), 10);
      user = await prisma.user.create({
        data: {
          googleSubject: identity.subject,
          name: v.name,
          email: v.email,
          passwordHash: dummyPassword,
          status: 'ACTIVE',
          memberships: { create: v.role === 'DELIVERY'
            ? [{ role: 'CUSTOMER', status: 'ACTIVE' }, { role: 'DELIVERY', status: 'PENDING' }]
            : { role: 'CUSTOMER', status: 'ACTIVE' } },
          ...(v.role === 'DELIVERY' ? {
            deliveryProfile: {
              create: {
                employer: 'Not verified',
                deliveryReference: `GOOG-${randomBytes(4).toString('hex').toUpperCase()}`,
                reviewStatus: 'PENDING',
                phoneVerifiedAt: null,
              },
            },
          } : {}),
          customerProfile: { create: { defaultName: v.name } },
        },
        include: { memberships: true, deliveryProfile: true, seller: true },
      });

      seller = user.seller || null;
    } else {
      if (user.status !== 'ACTIVE') throw err('FORBIDDEN', 'Account is not active', 403);
      if (v.role === 'DELIVERY' && !user.deliveryProfile) throw err('DELIVERY_APPLICATION_REQUIRED', 'Sign up for delivery access first so an administrator can review your application.', 403);
      seller = await prisma.seller.findFirst({ where: { userId: user.id } });
    }

    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.credentialVersion = hashToken(user.passwordHash || 'google-session');
    if (seller) {
      req.session.sellerId = seller.id;
    }
    req.session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
    req.session.cookie.expires = new Date(req.session.sessionExpiresAt);
    await store.issue(req.sessionID, req.session);
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

    res.json({
      seller: seller ? { id: seller.id, email: seller.email, name: seller.name } : null,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.memberships?.filter((m: any) => m.status === 'ACTIVE').map((m: any) => m.role) || [],
        deliveryStatus: user.deliveryProfile?.reviewStatus,
      },
      mode: config.demo ? 'demo' : 'manual',
    });
  });

  // Phone OTP Send
  app.post('/api/auth/phone/otp-request', limits.loginIp, async (req, res) => {
    if (!config.demo) throw err('OTP_PROVIDER_UNAVAILABLE', 'SMS verification is not configured', 503);
    const v = z.object({ phone: z.string().trim().min(10).max(20) }).parse(req.body);
    const code = String(randomBytes(3).readUIntBE(0, 3) % 900000 + 100000);
    const codeHash = hashToken(code);
    const expiresAt = new Date(Date.now() + 300_000);

    const challenge = await prisma.authOtpChallenge.create({
      data: {
        phone: v.phone,
        codeHash,
        purpose: 'LOGIN',
        expiresAt,
      },
    });

    res.json({
      success: true,
      challengeId: challenge.id,
      phone: v.phone,
      expiresAt,
      devCode: code, // Provided for instant multi-device testing
      message: 'OTP generated. Enter the 6-digit code to verify.',
    });
  });

  // Phone OTP Verify & Login
  app.post('/api/auth/phone/otp-login', limits.loginIp, async (req, res) => {
    if (!config.demo) throw err('OTP_PROVIDER_UNAVAILABLE', 'SMS verification is not configured', 503);
    const v = z.object({
      phone: z.string().trim().min(10).max(20),
      code: z.string().regex(/^\d{6}$/),
      role: z.enum(['SELLER', 'DELIVERY', 'CUSTOMER']).default('CUSTOMER'),
      name: z.string().trim().max(100).optional(),
    }).parse(req.body);
    assertRoleRequestAllowed(v.role);
    const challenge = await prisma.authOtpChallenge.findFirst({
      where: {
        phone: v.phone,
        codeHash: hashToken(v.code),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw err('INVALID_OTP', 'The entered code is invalid or has expired', 400);
    }

    await prisma.authOtpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date(), verifiedAt: new Date() },
    });

    let user: any = await prisma.user.findUnique({
      where: { phone: v.phone },
      include: { memberships: true, deliveryProfile: true },
    });

    let seller: any = null;

    if (!user) {
      const dummyPassword = await bcrypt.hash(randomBytes(16).toString('hex'), 10);
      user = await prisma.user.create({
        data: {
          name: v.name || `User ${v.phone.slice(-4)}`,
          phone: v.phone,
          passwordHash: dummyPassword,
          status: 'ACTIVE',
          memberships: { create: v.role === 'DELIVERY'
            ? [{ role: 'CUSTOMER', status: 'ACTIVE' }, { role: 'DELIVERY', status: 'PENDING' }]
            : { role: 'CUSTOMER', status: 'ACTIVE' } },
          ...(v.role === 'DELIVERY' ? {
            deliveryProfile: {
              create: {
                employer: 'Independent Courier',
                deliveryReference: `PH-${randomBytes(4).toString('hex').toUpperCase()}`,
                reviewStatus: 'PENDING',
          phoneVerifiedAt: null,
              },
            },
          } : {}),
          customerProfile: { create: { defaultName: v.name || `Customer ${v.phone.slice(-4)}` } },
        },
        include: { memberships: true, deliveryProfile: true },
      });

      if (v.role === 'SELLER') {
        seller = await prisma.seller.create({
          data: {
            id: user.id,
            email: `${user.id}@seller.unloss.local`,
            name: user.name,
            passwordHash: dummyPassword,
            userId: user.id,
          },
        });
      }
    } else {
      if (v.role === 'DELIVERY' && !user.deliveryProfile) throw err('DELIVERY_APPLICATION_REQUIRED', 'Sign up for delivery access first so an administrator can review your application.', 403);
      seller = await prisma.seller.findFirst({ where: { userId: user.id } });
    }

    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.credentialVersion = hashToken(user.passwordHash || 'phone-session');
    if (seller) {
      req.session.sellerId = seller.id;
    }
    req.session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
    req.session.cookie.expires = new Date(req.session.sessionExpiresAt);
    await store.issue(req.sessionID, req.session);
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

    res.json({
      seller: seller ? { id: seller.id, email: seller.email, name: seller.name } : null,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.memberships?.filter((m: any) => m.status === 'ACTIVE').map((m: any) => m.role) || [],
        deliveryStatus: user.deliveryProfile?.reviewStatus,
      },
      mode: config.demo ? 'demo' : 'manual',
    });
  });

  if (config.demo) {
    app.post('/api/auth/demo-switch', async (req, res) => {
      if (!req.session?.userId || !req.session.sessionExpiresAt || req.session.sessionExpiresAt <= Date.now()) throw err('UNAUTHENTICATED', 'Sign in before switching local demo accounts', 401);
      const actor = await prisma.user.findUnique({ where: { id: req.session.userId }, include: { memberships: true } });
      if (!actor?.memberships.some(m => m.role === 'ADMIN' && m.status === 'ACTIVE')) throw err('FORBIDDEN', 'Only a signed-in local administrator can switch demo accounts', 403);
      const v = z.object({ role: z.enum(['SELLER', 'DELIVERY', 'CUSTOMER', 'ADMIN']) }).parse(req.body);
      let targetUser: any = null;
      let targetSeller: any = null;

      if (v.role === 'SELLER') {
        targetSeller = await prisma.seller.findFirst();
        if (targetSeller?.userId) {
          targetUser = await prisma.user.findUnique({ where: { id: targetSeller.userId }, include: { memberships: true, deliveryProfile: true } });
        }
      } else {
        targetUser = await prisma.user.findFirst({
          where: { memberships: { some: { role: v.role, status: 'ACTIVE' } } },
          include: { memberships: true, deliveryProfile: true },
        });
      }

      if (!targetUser && !targetSeller) throw err('NOT_FOUND', `No seeded demo account for role ${v.role}`, 404);

      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      if (targetSeller) {
        req.session.sellerId = targetSeller.id;
        req.session.credentialVersion = hashToken(targetSeller.passwordHash);
        if (targetUser) req.session.userId = targetUser.id;
      } else if (targetUser) {
        req.session.userId = targetUser.id;
        req.session.credentialVersion = hashToken(targetUser.passwordHash || 'demo-hash');
      }
      req.session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
      req.session.cookie.expires = new Date(req.session.sessionExpiresAt);
      await store.issue(req.sessionID, req.session);
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

      res.json({
        seller: targetSeller ? { id: targetSeller.id, email: targetSeller.email, name: targetSeller.name } : null,
        user: targetUser ? {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          phone: targetUser.phone,
          roles: targetUser.memberships ? targetUser.memberships.filter((m: any) => m.status === 'ACTIVE').map((m: any) => m.role) : [],
          deliveryStatus: targetUser.deliveryProfile?.reviewStatus,
        } : null,
        mode: 'demo',
      });
    });
  }
}
