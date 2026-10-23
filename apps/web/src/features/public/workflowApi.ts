import { api, type OrderStatus, type ReasonCode } from '../../api';

export type DeliveryOutcome = 'DELIVERY_ATTEMPTED' | 'CUSTOMER_UNAVAILABLE' | 'CUSTOMER_REJECTED' | 'ADDRESS_ISSUE' | 'DELIVERED_VERIFIED';
export type CustomerAction = 'ACCEPT' | 'REJECT' | 'REQUEST_REDELIVERY';
export interface PublicPreview { orderReference: string; status: OrderStatus; allowedActions?: CustomerAction[]; permittedOutcomes?: DeliveryOutcome[] }
export interface Challenge { challengeId: string; expiresAt: string; devCode?: string; demoLabel?: string }
export interface Proof { verificationToken: string; expiresAt: string }
export interface ActionResult { order: { status: OrderStatus } }
export interface WorkflowApi {
  preview(kind: 'delivery' | 'customer', token: string, signal?: AbortSignal): Promise<PublicPreview>;
  requestOtp(token: string): Promise<Challenge>;
  verifyOtp(token: string, challengeId: string, code: string): Promise<Proof>;
  decide(token: string, proof: string, body: { action: CustomerAction; reasonCode: ReasonCode | null; note: string | null }): Promise<ActionResult>;
  deliver(token: string, body: { outcome: DeliveryOutcome; reasonCode: ReasonCode | null; note: string | null }): Promise<ActionResult>;
}
const post = <T,>(path: string, body: unknown, headers?: HeadersInit) => api<T>(path, { method: 'POST', body: JSON.stringify(body), headers });
const customer = (token: string) => `/customer/${encodeURIComponent(token)}`;
/** Exact contract routes. Live writes are release-gated until backend defects are resolved. */
export const liveWorkflowApi: WorkflowApi = {
  preview: (kind, token, signal) => api(`/${kind}/${encodeURIComponent(token)}`, { signal }),
  requestOtp: token => post(`${customer(token)}/request-otp`, {}),
  verifyOtp: (token, challengeId, code) => post(`${customer(token)}/verify-otp`, { challengeId, code }),
  decide: (token, proof, body) => post(`${customer(token)}/decision`, body, { 'X-Customer-Verification': proof }),
  deliver: (token, body) => post(`/delivery/${encodeURIComponent(token)}`, body),
};
// No environment override: a frontend flag cannot fix backend authorization/privacy.
export const LIVE_PUBLIC_WRITES_READY = false;
