import type { Order } from '@prisma/client';

/** Explicit shared contract fields: future DB columns must not silently expand HTTP output. */
export const sellerOrder = (o: Order) => ({
  id: o.id, sellerId: o.sellerId, sellerReference: o.sellerReference, status: o.status,
  customerName: o.customerName, customerPhone: o.customerPhone, addressLine1: o.addressLine1, addressLine2: o.addressLine2,
  city: o.city, state: o.state, postalCode: o.postalCode, createdAt: o.createdAt, updatedAt: o.updatedAt,
});
