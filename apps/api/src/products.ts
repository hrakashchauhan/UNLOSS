import type { Express } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { currentSeller, requireSeller } from './auth.js';
import { err } from './http.js';
import { hashToken } from './rules.js';

const encryptToken = (token: string) => Buffer.from(token).toString('base64url');
const createTokenPair = () => ({ delivery: randomBytes(32).toString('base64url'), customer: randomBytes(32).toString('base64url') });

export function registerProductRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireSeller(prisma, config);

  app.get('/api/products', auth, async (_req, res) => {
    const sellerId = currentSeller(res).id;
    const items = await prisma.product.findMany({ where: { sellerId, archivedAt: null }, orderBy: { createdAt: 'desc' } });
    res.json({ items });
  });

  app.post('/api/products', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const v = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), sku: z.string().trim().max(80).optional(), defaultQuantity: z.coerce.number().int().min(1).max(10000).optional() }).parse(req.body);
    const product = await prisma.product.create({ data: { sellerId, name: v.name, description: v.description || null, sku: v.sku || null, defaultQuantity: v.defaultQuantity || 1 } });
    res.status(201).json({ product });
  });

  app.get('/api/drafts', auth, async (_req, res) => {
    const sellerId = currentSeller(res).id;
    const items = await prisma.orderDraft.findMany({ where: { sellerId, archivedAt: null }, include: { product: true, tokens: true }, orderBy: { updatedAt: 'desc' } });
    res.json({ items });
  });

  app.post('/api/drafts', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const v = z.object({ productName: z.string().trim().min(1).max(160), quantity: z.coerce.number().int().min(1).max(10000).optional() }).parse(req.body);
    const tokens = createTokenPair();
    const expiresAt = new Date(Date.now() + config.qrTokenTtlDays * 864e5);
    const result = await prisma.$transaction(async tx => {
      let product = await tx.product.findFirst({ where: { sellerId, name: { equals: v.productName, mode: 'insensitive' }, archivedAt: null } });
      if (!product) product = await tx.product.create({ data: { sellerId, name: v.productName.trim(), defaultQuantity: v.quantity || 1 } });
      const draft = await tx.orderDraft.create({ data: { sellerId, productId: product.id, quantity: v.quantity || 1, status: 'DRAFT' } });
      await tx.draftQrToken.createMany({ data: [
        { draftId: draft.id, purpose: 'DELIVERY', tokenHash: hashToken(tokens.delivery), encryptedToken: encryptToken(tokens.delivery), expiresAt },
        { draftId: draft.id, purpose: 'CUSTOMER', tokenHash: hashToken(tokens.customer), encryptedToken: encryptToken(tokens.customer), expiresAt },
      ] });
      return { draft, product, tokens };
    });
    res.status(201).json({ draft: result.draft, product: result.product, qr: { deliveryUrl: `${config.appOrigin}/draft/delivery/${tokens.delivery}`, customerUrl: `${config.appOrigin}/draft/customer/${tokens.customer}` }, status: 'AWAITING_ACTIVATION' });
  });

  app.get('/api/drafts/:id', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const draft = await prisma.orderDraft.findFirst({ where: { id: String(req.params.id), sellerId }, include: { product: true, tokens: true } });
    if (!draft) throw err('NOT_FOUND', 'Draft not found', 404);
    res.json({ draft });
  });

  app.patch('/api/drafts/:id', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const v = z.object({ quantity: z.coerce.number().int().min(1).max(10000).optional(), recipientName: z.string().trim().max(160).optional(), recipientPhone: z.string().trim().max(20).optional(), addressLine1: z.string().trim().max(200).optional(), addressLine2: z.string().trim().max(200).optional(), city: z.string().trim().max(160).optional(), state: z.string().trim().max(160).optional(), postalCode: z.string().trim().max(32).optional(), courier: z.string().trim().max(80).optional(), trackingNumber: z.string().trim().max(80).optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
    const draft = await prisma.orderDraft.updateMany({ where: { id: String(req.params.id), sellerId, status: 'DRAFT' }, data: v });
    if (!draft.count) throw err('NOT_FOUND', 'Draft not found or not editable', 404);
    const updated = await prisma.orderDraft.findFirst({ where: { id: String(req.params.id), sellerId }, include: { product: true, tokens: true } });
    res.json({ draft: updated });
  });

  app.post('/api/drafts/:id/duplicate', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const source = await prisma.orderDraft.findFirst({ where: { id: String(req.params.id), sellerId }, include: { tokens: true } });
    if (!source) throw err('NOT_FOUND', 'Draft not found', 404);
    const tokens = createTokenPair();
    const expiresAt = new Date(Date.now() + config.qrTokenTtlDays * 864e5);
    const dup = await prisma.$transaction(async tx => {
      const draft = await tx.orderDraft.create({ data: { sellerId, productId: source.productId, quantity: source.quantity, recipientName: source.recipientName, recipientPhone: source.recipientPhone, addressLine1: source.addressLine1, addressLine2: source.addressLine2, city: source.city, state: source.state, postalCode: source.postalCode, courier: source.courier, trackingNumber: source.trackingNumber, notes: source.notes, status: 'DRAFT' } });
      await tx.draftQrToken.createMany({ data: [
        { draftId: draft.id, purpose: 'DELIVERY', tokenHash: hashToken(tokens.delivery), encryptedToken: encryptToken(tokens.delivery), expiresAt },
        { draftId: draft.id, purpose: 'CUSTOMER', tokenHash: hashToken(tokens.customer), encryptedToken: encryptToken(tokens.customer), expiresAt },
      ] });
      return draft;
    });
    res.status(201).json({ draft: dup, qr: { deliveryUrl: `${config.appOrigin}/draft/delivery/${tokens.delivery}`, customerUrl: `${config.appOrigin}/draft/customer/${tokens.customer}` } });
  });

  app.post('/api/drafts/:id/archive', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const draft = await prisma.orderDraft.updateMany({ where: { id: String(req.params.id), sellerId }, data: { archivedAt: new Date() } });
    if (!draft.count) throw err('NOT_FOUND', 'Draft not found', 404);
    res.status(204).end();
  });

  app.post('/api/drafts/:id/activate', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const draft = await prisma.orderDraft.findFirst({ where: { id: String(req.params.id), sellerId, archivedAt: null }, include: { product: true, tokens: true } });
    if (!draft) throw err('NOT_FOUND', 'Draft not found', 404);
    if (!draft.recipientName || !draft.recipientPhone || !draft.addressLine1 || !draft.city || !draft.state || !draft.postalCode) throw err('VALIDATION_ERROR', 'Add recipient, address, quantity and courier details before activation', 400);
    if (draft.activatedOrderId) throw err('CONFLICT', 'Draft already activated', 409);
    const tokens = createTokenPair();
    const expiresAt = new Date(Date.now() + config.qrTokenTtlDays * 864e5);
    const result = await prisma.$transaction(async tx => {
      const order = await tx.order.create({ data: {
        sellerId, productId: draft.productId, draftId: draft.id, sellerReference: draft.product.name,
        itemName: draft.product.name, itemDescription: draft.product.description, quantity: draft.quantity,
        customerName: draft.recipientName!, customerPhone: draft.recipientPhone!,
        addressLine1: draft.addressLine1!, addressLine2: draft.addressLine2, city: draft.city!, state: draft.state!, postalCode: draft.postalCode!,
      } });
      await tx.orderEvent.create({ data: { orderId: order.id, eventType: 'CREATED', toStatus: 'CREATED', actorType: 'SELLER', actorId: sellerId, source: config.demo ? 'DEMO' : 'MANUAL' } });
      await tx.qrToken.createMany({ data: [
        { orderId: order.id, purpose: 'DELIVERY', tokenHash: hashToken(tokens.delivery), expiresAt },
        { orderId: order.id, purpose: 'CUSTOMER', tokenHash: hashToken(tokens.customer), expiresAt },
      ] });
      await tx.orderDraft.update({ where: { id: draft.id }, data: { status: 'ACTIVATED', activatedOrderId: order.id } });
      return order;
    });
    res.status(201).json({ orderId: result.id, qr: { deliveryUrl: `${config.appOrigin}/delivery/${tokens.delivery}`, customerUrl: `${config.appOrigin}/customer/${tokens.customer}` } });
  });

  app.get('/api/drafts/public/:token', async (req, res) => {
    const token = String(req.params.token);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw err('TOKEN_INVALID', 'Token is invalid', 404);
    const dt = await prisma.draftQrToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { draft: { include: { product: true } } } });
    if (!dt || dt.revokedAt || dt.expiresAt <= new Date()) throw err('TOKEN_INVALID', 'Token is invalid', 404);
    if (dt.draft.status === 'ACTIVATED' || dt.draft.activatedOrderId) throw err('TOKEN_INVALID', 'Token is invalid', 404);
    res.json({ status: 'AWAITING_ACTIVATION', purpose: dt.purpose, productName: dt.draft.product.name, quantity: dt.draft.quantity, hasRecipient: !!dt.draft.recipientName });
  });
}
