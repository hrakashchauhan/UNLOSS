/** HTTP shapes follow docs/API_CONTRACT.md and the current API implementation. */
export type OrderStatus = 'CREATED' | 'READY_FOR_DISPATCH' | 'OUT_FOR_DELIVERY' | 'DELIVERY_ATTEMPTED' | 'DELIVERED_VERIFIED' | 'CUSTOMER_REJECTED' | 'DELIVERY_FAILED' | 'RETURN_INITIATED' | 'RETURN_IN_TRANSIT' | 'RETURNED_TO_SELLER' | 'REDELIVERY_REQUESTED' | 'CANCELLED';
export type ReasonCode = 'CUSTOMER_UNAVAILABLE' | 'CUSTOMER_REJECTED' | 'ADDRESS_INCORRECT' | 'ADDRESS_INCOMPLETE' | 'PHONE_UNREACHABLE' | 'DELIVERY_DELAY' | 'PACKAGE_DAMAGED' | 'PACKAGE_MISMATCH' | 'CUSTOMER_REQUESTED_REDELIVERY' | 'SELLER_CANCELLED' | 'COURIER_REPORTED_OTHER' | 'OTHER';
export type ActorType = 'SELLER' | 'DELIVERY' | 'CUSTOMER' | 'SYSTEM';
export type EventSourceOrigin = 'MANUAL' | 'DEMO' | 'INTEGRATION';
export interface Seller { id: string; name: string; email: string }
export interface RawOrder {
  id: string; sellerId: string; sellerReference: string | null; status: OrderStatus;
  deliveryAttempt?: number;
  customerName: string; customerPhone: string; addressLine1: string; addressLine2: string | null;
  city: string; state: string; postalCode: string; createdAt: string; updatedAt: string;
}
export interface Order {
  id: string; sellerReference: string | null; status: OrderStatus; createdAt: string; updatedAt: string;
  deliveryAttempt?: number;
  customer: { name: string; phone: string };
  deliveryAddress: { line1: string; line2: string | null; city: string; state: string; postalCode: string };
  customerName?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}
export interface Event {
  id: string; orderId: string; eventType: string; fromStatus: OrderStatus | null; toStatus: OrderStatus | null;
  actorType: ActorType; actorId: string | null; reasonCode: ReasonCode | null; note: string | null;
  source: EventSourceOrigin; createdAt: string; metadata?: Record<string, unknown> | null;
}
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface DashboardSummary { totalOrders: number; statusCounts: Partial<Record<OrderStatus, number>>; rewardTotalPaise: number }
export interface CreateOrderRequest {
  sellerReference?: string; customer: { name: string; phone: string };
  deliveryAddress: { line1: string; line2?: string; city: string; state: string; postalCode: string };
}
export interface OrderCreated { order: Order; qr: { deliveryUrl: string; customerUrl: string } }
export interface OrderDetail { order: Order; events: Event[] }
export interface RewardSummary { creditCount: number; totalPaise: number; currency: string }
export interface LedgerEntry { id: string; orderId: string; amountPaise: number; currency: string; type: 'DELIVERY_REWARD' | 'REVERSAL'; eligibilityReason: string; createdAt: string }
export interface Notification { id: string; title: string; body: string; createdAt: string }
export interface MonthlyReport {
  month: string; timezone: string; periodStart: string; periodEnd: string;
  totalOrdersCreated: number; ordersDispatched: number; deliveryAttempts: number; verifiedCompletions: number;
  returnsToSeller: number; returnRate: number | null; returnRateNumerator: number; returnRateDenominator: number;
  redeliveryRequests: number; rewardCreditCount: number; rewardTotalPaise: number; reasonCounts: Record<string, number>;
}
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
    deliveryAttempt: raw.deliveryAttempt ?? 0,
    customer: { name: raw.customerName, phone: raw.customerPhone },
    deliveryAddress: { line1: raw.addressLine1, line2: raw.addressLine2, city: raw.city, state: raw.state, postalCode: raw.postalCode },
    customerName: raw.customerName,
    addressLine1: raw.addressLine1,
    city: raw.city,
    state: raw.state,
    postalCode: raw.postalCode,
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
  async transition(id: string, body: { toStatus: OrderStatus; reasonCode: ReasonCode | null; note: string | null }) {
    const result = await api<{ order: RawOrder; event: Event }>(`/orders/${encodeURIComponent(id)}/transitions`, { method: 'POST', body: JSON.stringify(body) });
    return { order: normalizeOrder(result.order), event: result.event };
  },
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

export interface Product { id: string; name: string; description: string | null; sku: string | null; defaultQuantity: number; createdAt: string }
export interface DraftQrToken { id: string; purpose: 'DELIVERY' | 'CUSTOMER'; tokenHash: string; encryptedToken: string; expiresAt: string; revokedAt: string | null }
export interface OrderDraft {
  id: string; sellerId: string; productId: string; status: 'DRAFT' | 'ACTIVATED';
  quantity: number; recipientName: string | null; recipientPhone: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null;
  courier: string | null; trackingNumber: string | null; notes: string | null; activatedOrderId: string | null;
  createdAt: string; updatedAt: string; product: Product; tokens: DraftQrToken[];
}
export interface DraftCreated {
  draft: OrderDraft; product: Product; qr: { deliveryUrl: string; customerUrl: string }; status: string;
}
export interface ParcelClaim {
  id: string; orderId: string; deliveryUserId: string; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null; rejectionReason: string | null; claimedAt: string; decidedAt: string | null;
  order?: RawOrder; deliveryUser?: { id: string; name: string; phone?: string };
}
export interface FundingAccount { availablePaise: number; reservedPaise: number; refundedPaise: number }
export interface FundingTransaction { id: string; provider: string; providerOrderId: string; totalPaise: number; principalPaise: number; status: string; createdAt: string }
export interface BudgetReservation { id: string; orderId: string; rewardPaise: number; feeAllowancePaise: number; totalPaise: number; status: string; createdAt: string; order?: RawOrder }
export interface DeliveryEarning { id: string; orderId: string; amountPaise: number; status: 'PENDING' | 'ELIGIBLE' | 'PAID'; createdAt: string; order?: RawOrder }
export interface PayoutAccount { id: string; method: string; upiId?: string; accountName?: string; accountNumberLast4?: string; ifsc?: string; status: string }
export interface DeliveryProfileRow { id: string; userId: string; employer: string; deliveryReference: string; reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED'; user: { id: string; name: string; email: string | null; phone: string | null } }

export const draftsApi = {
  async list(signal?: AbortSignal): Promise<{ items: OrderDraft[] }> {
    return api<{ items: OrderDraft[] }>('/drafts', { signal });
  },
  async create(body: { productName: string; quantity?: number }): Promise<DraftCreated> {
    return api<DraftCreated>('/drafts', { method: 'POST', body: JSON.stringify(body) });
  },
  async get(id: string, signal?: AbortSignal): Promise<{ draft: OrderDraft }> {
    return api<{ draft: OrderDraft }>(`/drafts/${encodeURIComponent(id)}`, { signal });
  },
  async update(id: string, body: Partial<OrderDraft>): Promise<{ draft: OrderDraft }> {
    return api<{ draft: OrderDraft }>(`/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  async duplicate(id: string): Promise<{ draft: OrderDraft; qr: { deliveryUrl: string; customerUrl: string } }> {
    return api<{ draft: OrderDraft; qr: { deliveryUrl: string; customerUrl: string } }>(`/drafts/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  },
  async archive(id: string): Promise<void> {
    return api<void>(`/drafts/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  },
  async activate(id: string): Promise<{ orderId: string; qr: { deliveryUrl: string; customerUrl: string } }> {
    return api<{ orderId: string; qr: { deliveryUrl: string; customerUrl: string } }>(`/drafts/${encodeURIComponent(id)}/activate`, { method: 'POST' });
  },
};

export const claimsApi = {
  async deliveryPending(signal?: AbortSignal): Promise<{ items: RawOrder[] }> {
    return api<{ items: RawOrder[] }>('/delivery/pending', { signal });
  },
  async claimOrder(id: string, coords?: { latitude?: number; longitude?: number; accuracyMeters?: number }): Promise<{ claim: ParcelClaim }> {
    return api<{ claim: ParcelClaim }>(`/orders/${encodeURIComponent(id)}/claim`, { method: 'POST', body: JSON.stringify(coords || {}) });
  },
  async sellerClaims(signal?: AbortSignal): Promise<{ items: ParcelClaim[] }> {
    return api<{ items: ParcelClaim[] }>('/seller/claims', { signal });
  },
  async decide(id: string, action: 'APPROVE' | 'REJECT', reason?: string): Promise<{ claim: ParcelClaim }> {
    return api<{ claim: ParcelClaim }>(`/seller/claims/${encodeURIComponent(id)}/decide`, { method: 'POST', body: JSON.stringify({ action, reason }) });
  },
};

export const fundingApi = {
  async getSummary(signal?: AbortSignal): Promise<{ account: FundingAccount; txns: FundingTransaction[]; reservations: BudgetReservation[]; earnings: DeliveryEarning[] }> {
    return api<{ account: FundingAccount; txns: FundingTransaction[]; reservations: BudgetReservation[]; earnings: DeliveryEarning[] }>('/seller/funding', { signal });
  },
  async checkout(amountPaise: number): Promise<{ providerOrderId: string; principalPaise: number; feePaise: number; totalPaise: number; currency: string }> {
    return api<{ providerOrderId: string; principalPaise: number; feePaise: number; totalPaise: number; currency: string }>('/seller/funding/checkout', { method: 'POST', body: JSON.stringify({ amountPaise }) });
  },
  async capture(providerOrderId: string, providerPaymentId: string): Promise<{ status: string; transaction: FundingTransaction }> {
    return api<{ status: string; transaction: FundingTransaction }>('/seller/funding/capture', { method: 'POST', body: JSON.stringify({ providerOrderId, providerPaymentId }) });
  },
  async reserve(orderId: string): Promise<{ reservation: BudgetReservation }> {
    return api<{ reservation: BudgetReservation }>(`/orders/${encodeURIComponent(orderId)}/fund-reserve`, { method: 'POST' });
  },
};

export const deliveryApi = {
  async earnings(signal?: AbortSignal): Promise<{ items: DeliveryEarning[]; eligiblePaise: number; payoutAccount: PayoutAccount | null }> {
    return api<{ items: DeliveryEarning[]; eligiblePaise: number; payoutAccount: PayoutAccount | null }>('/delivery/earnings', { signal });
  },
  async savePayoutAccount(body: { method: 'UPI' | 'BANK'; upiId?: string; accountName?: string; accountNumberLast4?: string; ifsc?: string }): Promise<{ account: PayoutAccount }> {
    return api<{ account: PayoutAccount }>('/delivery/payout-account', { method: 'POST', body: JSON.stringify(body) });
  },
};

export const adminApi = {
  async deliveryAccounts(signal?: AbortSignal): Promise<{ items: DeliveryProfileRow[] }> {
    return api<{ items: DeliveryProfileRow[] }>('/admin/delivery-accounts', { signal });
  },
  async reviewAccount(id: string, action: 'APPROVE' | 'REJECT', reason?: string): Promise<{ profile: DeliveryProfileRow }> {
    return api<{ profile: DeliveryProfileRow }>(`/admin/delivery-accounts/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) });
  },
  async runPayouts(): Promise<{ batch: { id: string; status: string; scheduledFor: string }; note: string }> {
    return api<{ batch: { id: string; status: string; scheduledFor: string }; note: string }>('/admin/payouts/run', { method: 'POST' });
  },
};

export const shipmentApi = {
  async register(orderId: string, courier: string, trackingNumber: string): Promise<{ shipment: any }> {
    return api<{ shipment: any }>(`/orders/${encodeURIComponent(orderId)}/shipment`, { method: 'POST', body: JSON.stringify({ courier, trackingNumber }) });
  },
  async get(orderId: string, signal?: AbortSignal): Promise<{ shipment: any }> {
    return api<{ shipment: any }>(`/orders/${encodeURIComponent(orderId)}/shipment`, { signal });
  },
  async simulateWebhook(body: { trackingNumber: string; status: string; occurredAt: string; providerEventId: string; message?: string }): Promise<{ accepted: boolean }> {
    return api<{ accepted: boolean }>('/integrations/aftership/webhook', { method: 'POST', body: JSON.stringify(body) });
  },
};

export const authApi = {
  async session(signal?: AbortSignal): Promise<{ seller: Seller | null; user: { id: string; name: string; email: string | null; phone: string | null; roles: string[]; deliveryStatus?: string } | null; mode: string }> {
    return api<{ seller: Seller | null; user: { id: string; name: string; email: string | null; phone: string | null; roles: string[]; deliveryStatus?: string } | null; mode: string }>('/auth/session', { signal });
  },
  async demoSwitch(role: 'SELLER' | 'DELIVERY' | 'CUSTOMER' | 'ADMIN'): Promise<{ seller: Seller | null; user: any; mode: string }> {
    return api<{ seller: Seller | null; user: any; mode: string }>('/auth/demo-switch', { method: 'POST', body: JSON.stringify({ role }) });
  },
  async register(body: any): Promise<{ user: any }> {
    return api<{ user: any }>('/auth/register', { method: 'POST', body: JSON.stringify(body) });
  },
};

export function subscribeToLiveEvents(callbacks: {
  onEvent?: (event: any) => void;
  onStatusChange?: (status: 'connected' | 'reconnecting' | 'offline', lastTime?: string) => void;
}): () => void {
  let eventSource: InstanceType<typeof window.EventSource> | null = null;
  let pollTimer: number | null = null;
  let active = true;
  let lastEventId = '';
  let lastTime = '';

  const startPollingFallback = () => {
    callbacks.onStatusChange?.('offline', lastTime);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = window.setInterval(async () => {
      if (!active) return;
      try {
        const url = `${API_BASE}/events/poll${lastTime ? `?since=${encodeURIComponent(lastTime)}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json.timestamp) lastTime = json.timestamp;
          if (Array.isArray(json.items)) {
            for (const item of json.items) {
              callbacks.onEvent?.(item);
            }
          }
          callbacks.onStatusChange?.('connected', lastTime);
        }
      } catch {
        callbacks.onStatusChange?.('offline', lastTime);
      }
    }, 10_000);
  };

  const connect = () => {
    if (!active || typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      startPollingFallback();
      return;
    }

    callbacks.onStatusChange?.('reconnecting', lastTime);
    const url = `${API_BASE}/events/live${lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : ''}`;

    try {
      eventSource = new window.EventSource(url, { withCredentials: true });

      eventSource.onopen = () => {
        callbacks.onStatusChange?.('connected', new Date().toLocaleTimeString());
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      eventSource.addEventListener('connected', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          lastTime = data.timestamp || new Date().toLocaleTimeString();
          callbacks.onStatusChange?.('connected', lastTime);
        } catch { /* noop */ }
      });

      const handleIncoming = (e: MessageEvent) => {
        if (e.lastEventId) lastEventId = e.lastEventId;
        lastTime = new Date().toLocaleTimeString();
        callbacks.onStatusChange?.('connected', lastTime);
        try {
          const parsed = JSON.parse(e.data);
          callbacks.onEvent?.(parsed);
        } catch { /* noop */ }
      };

      eventSource.addEventListener('order.update', handleIncoming);
      eventSource.addEventListener('claim.submitted', handleIncoming);
      eventSource.addEventListener('claim.decided', handleIncoming);

      eventSource.onerror = () => {
        if (!active) return;
        callbacks.onStatusChange?.('reconnecting', lastTime);
        eventSource?.close();
        setTimeout(() => {
          if (active && eventSource?.readyState === window.EventSource.CLOSED) {
            startPollingFallback();
          }
        }, 3000);
      };
    } catch {
      startPollingFallback();
    }
  };

  connect();

  return () => {
    active = false;
    if (eventSource) eventSource.close();
    if (pollTimer) clearInterval(pollTimer);
  };
}
