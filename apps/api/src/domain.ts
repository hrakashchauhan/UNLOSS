import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { err } from './http.js';
import { isTransitionAllowed } from './rules.js';

export const statuses = ['CREATED','READY_FOR_DISPATCH','OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','DELIVERED_VERIFIED','CUSTOMER_REJECTED','DELIVERY_FAILED','RETURN_INITIATED','RETURN_IN_TRANSIT','RETURNED_TO_SELLER','REDELIVERY_REQUESTED','CANCELLED'] as const;
export const reasons = ['CUSTOMER_UNAVAILABLE','CUSTOMER_REJECTED','ADDRESS_INCORRECT','ADDRESS_INCOMPLETE','PHONE_UNREACHABLE','DELIVERY_DELAY','PACKAGE_DAMAGED','PACKAGE_MISMATCH','CUSTOMER_REQUESTED_REDELIVERY','SELLER_CANCELLED','COURIER_REPORTED_OTHER','OTHER'] as const;
export const reasonFields = { reasonCode: z.enum(reasons).nullable().optional(), note: z.string().trim().max(1000).nullable().optional() };
const integer = (fallback: string, max: number) => z.string().regex(/^[1-9]\d*$/).default(fallback).transform(Number).pipe(z.number().int().max(max));
export const paginationSchema = z.object({ page: integer('1', 1_000_000), pageSize: integer('25', 100) });
export const pagination = (query: unknown) => paginationSchema.parse(query);

// All mutation paths acquire this lock before reading state. SQL values remain bound parameters.
export async function lockOrder(tx: Prisma.TransactionClient, id: string, sellerId?: string) {
  const rows = sellerId === undefined
    ? await tx.$queryRaw<{id: string}[]>`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`
    : await tx.$queryRaw<{id: string}[]>`SELECT id FROM "Order" WHERE id = ${id} AND "sellerId" = ${sellerId} FOR UPDATE`;
  if (!rows.length) throw err('NOT_FOUND', 'Order not found', 404);
  return tx.order.findUniqueOrThrow({ where: { id } });
}

export function assertTransition(from: string, to: string) {
  if (!isTransitionAllowed(from, to)) throw err('INVALID_TRANSITION', 'Transition is not permitted for current status', 409);
}
