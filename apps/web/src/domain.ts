import type { OrderStatus, ReasonCode } from './api';

export const statuses: OrderStatus[] = ['CREATED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'DELIVERED_VERIFIED', 'CUSTOMER_REJECTED', 'DELIVERY_FAILED', 'RETURN_INITIATED', 'RETURN_IN_TRANSIT', 'RETURNED_TO_SELLER', 'REDELIVERY_REQUESTED', 'CANCELLED'];
export const reasons: ReasonCode[] = ['CUSTOMER_UNAVAILABLE', 'CUSTOMER_REJECTED', 'ADDRESS_INCORRECT', 'ADDRESS_INCOMPLETE', 'PHONE_UNREACHABLE', 'DELIVERY_DELAY', 'PACKAGE_DAMAGED', 'PACKAGE_MISMATCH', 'CUSTOMER_REQUESTED_REDELIVERY', 'SELLER_CANCELLED', 'COURIER_REPORTED_OTHER', 'OTHER'];
/** UI suggestions only. The server must authorize every transition. Verified completion is never seller-selectable. */
export const sellerSteps: Partial<Record<OrderStatus, OrderStatus[]>> = {
  CREATED: ['READY_FOR_DISPATCH', 'CANCELLED'], READY_FOR_DISPATCH: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['RETURN_INITIATED', 'REDELIVERY_REQUESTED'],
  DELIVERY_ATTEMPTED: ['OUT_FOR_DELIVERY', 'REDELIVERY_REQUESTED', 'RETURN_INITIATED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'REDELIVERY_REQUESTED', 'RETURN_INITIATED'],
  CUSTOMER_REJECTED: ['REDELIVERY_REQUESTED', 'RETURN_INITIATED'],
  REDELIVERY_REQUESTED: ['READY_FOR_DISPATCH', 'RETURN_INITIATED'],
  RETURN_INITIATED: ['RETURN_IN_TRANSIT'], RETURN_IN_TRANSIT: ['RETURNED_TO_SELLER'], RETURNED_TO_SELLER: ['REDELIVERY_REQUESTED'],
};
export const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
export function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}
