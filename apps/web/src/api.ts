/** HTTP shapes follow docs/API_CONTRACT.md and the current API implementation. */
export type OrderStatus = 'CREATED' | 'READY_FOR_DISPATCH' | 'OUT_FOR_DELIVERY' | 'DELIVERY_ATTEMPTED' | 'DELIVERED_VERIFIED' | 'CUSTOMER_REJECTED' | 'DELIVERY_FAILED' | 'RETURN_INITIATED' | 'RETURN_IN_TRANSIT' | 'RETURNED_TO_SELLER' | 'REDELIVERY_REQUESTED' | 'CANCELLED';
export type ReasonCode = 'CUSTOMER_UNAVAILABLE' | 'CUSTOMER_REJECTED' | 'ADDRESS_INCORRECT' | 'ADDRESS_INCOMPLETE' | 'PHONE_UNREACHABLE' | 'DELIVERY_DELAY' | 'PACKAGE_DAMAGED' | 'PACKAGE_MISMATCH' | 'CUSTOMER_REQUESTED_REDELIVERY' | 'SELLER_CANCELLED' | 'COURIER_REPORTED_OTHER' | 'OTHER';
export type ActorType = 'SELLER' | 'DELIVERY' | 'CUSTOMER' | 'SYSTEM';
export type EventSource = 'MANUAL' | 'DEMO' | 'INTEGRATION';
export interface Seller { id: string; name: string; email: string }
export interface RawOrder {
  id: string; sellerId: string; sellerReference: string | null; status: OrderStatus;
  customerName: string; customerPhone: string; addressLine1: string; addressLine2: string | null;
  city: string; state: string; postalCode: string; createdAt: string; updatedAt: string;
}
export interface Order {
  id: string; sellerReference: string | null; status: OrderStatus; createdAt: string; updatedAt: string;
  customer: { name: string; phone: string };
  deliveryAddress: { line1: string; line2: string | null; city: string; state: string; postalCode: string };
}
export interface Event {
  id: string; orderId: string; eventType: string; fromStatus: OrderStatus | null; toStatus: OrderStatus | null;
  actorType: ActorType; actorId: string | null; reasonCode: ReasonCode | null; note: string | null;
  source: EventSource; createdAt: string; metadata?: Record<string, unknown> | null;
}
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface DashboardSummary { totalOrders: number; statusCounts: Partial<Record<OrderStatus, number>>; rewardTotalPaise: number }
export interface CreateOrderRequest {
  sellerReference?: string; customer: { name: string; phone: string };
  deliveryAddress: { line1: string; line2?: string; city: string; state: string; postalCode: string };
}
export interface OrderCreated { order: Order; qr: { deliveryUrl: string; customerUrl: string } }
export interface OrderDetail { order: Order; events: Event[] }
export interface ApiErrorShape { error: { code: string; message: string; details?: unknown }; requestId?: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

const configuredBase = import.meta.env.VITE_API_BASE_URL || '/api';
export const API_BASE = configuredBase.replace(/\/$/, '');
let onSellerSessionExpired: (() => void) | undefined;

/** Registered by the seller auth provider; public token routes never expire seller state. */
export function registerSellerSessionExpired(handler?: () => void) {
  onSellerSessionExpired = handler;
}

export function normalizeOrder(raw: RawOrder): Order {
  return {
    id: raw.id, sellerReference: raw.sellerReference, status: raw.status,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    customer: { name: raw.customerName, phone: raw.customerPhone },
    deliveryAddress: { line1: raw.addressLine1, line2: raw.addressLine2, city: raw.city, state: raw.state, postalCode: raw.postalCode },
  };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, { ...options, headers, credentials: 'include' });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach UNLOSS. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let payload: Partial<ApiErrorShape> = {};
    if (contentType.includes('json')) {
      try { payload = await response.json(); } catch { /* Keep the HTTP status as the error. */ }
    }
    if (response.status === 401 && path !== '/auth/login' && !path.startsWith('/customer/') && !path.startsWith('/delivery/')) onSellerSessionExpired?.();
    throw new ApiError(response.status, payload.error?.code || 'REQUEST_FAILED', payload.error?.message || `Request failed (${response.status}).`, payload.requestId, payload.error?.details);
  }
  if (contentType.includes('text/csv')) return await response.text() as T;
  if (!contentType.includes('json')) throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.');
  try { return await response.json() as T; }
  catch { throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned invalid JSON.'); }
}

export const ordersApi = {
  async list(query: { q?: string; status?: string; page: number; pageSize: number }, signal?: AbortSignal): Promise<Page<Order>> {
    const response = await api<Page<RawOrder>>(`/orders${qs(query)}`, { signal });
    if (!Array.isArray(response?.items)) throw new ApiError(200, 'INVALID_RESPONSE', 'The server returned an invalid order list.');
    return { ...response, items: response.items.map(normalizeOrder) };
  },
  async create(body: CreateOrderRequest): Promise<OrderCreated> {
    const response = await api<{ order: RawOrder; qr: OrderCreated['qr'] }>('/orders', { method: 'POST', body: JSON.stringify(body) });
    if (!response?.order || !response?.qr) throw new ApiError(201, 'INVALID_RESPONSE', 'The server returned an incomplete order.');
    return { ...response, order: normalizeOrder(response.order) };
  },
  async detail(id: string, signal?: AbortSignal): Promise<OrderDetail> {
    const response = await api<{ order: RawOrder; events: Event[] }>(`/orders/${encodeURIComponent(id)}`, { signal });
    if (!response?.order || !Array.isArray(response.events)) throw new ApiError(200, 'INVALID_RESPONSE', 'The server returned incomplete order details.');
    return { order: normalizeOrder(response.order), events: response.events };
  },
};

export function qs(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') query.set(key, String(value));
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}
