import { useSyncExternalStore } from 'react';
import { ApiError, type OrderStatus } from '../../api';
import type { CustomerAction, DeliveryOutcome, WorkflowApi } from '../public/workflowApi';

export const DEMO_LABEL = 'DEMO — NOT OFFICIALLY VERIFIED';
export type VerificationState = 'NOT_STARTED' | 'CONTACT_PENDING' | 'CONTACT_VERIFIED' | 'DOCUMENT_READY' | 'PENDING_REVIEW' | 'NEEDS_INFORMATION' | 'REJECTED' | 'APPROVED';
interface Audit { id: number; actor: 'APPLICANT' | 'DEMO_PROVIDER' | 'DEMO_REVIEWER'; action: string; at: string }
interface DemoState { consent: boolean; verification: VerificationState; active: boolean; audit: Audit[]; status: OrderStatus; accepted: boolean; deliveryRecorded: boolean; rewardPaise: number; orderEvents: string[] }
const initial = (): DemoState => ({ consent: false, verification: 'NOT_STARTED', active: false, audit: [], status: 'OUT_FOR_DELIVERY', accepted: false, deliveryRecorded: false, rewardPaise: 0, orderEvents: [] });
let state = initial();
let challenge: { id: string; expires: number; requestedAt: number; attempts: number } | undefined;
let proof: { token: string; expires: number } | undefined;
const listeners = new Set<() => void>();
function update(next: Partial<DemoState>) { state = { ...state, ...next }; listeners.forEach(listener => listener()); }
export function useDemoState() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state); }
function fail(message: string, status = 409): never { throw new ApiError(status, 'DEMO_RULE', message); }
function audit(action: string, actor: Audit['actor'], next: Partial<DemoState>) { update({ ...next, audit: [...state.audit, { id: state.audit.length + 1, actor, action, at: new Date().toISOString() }] }); }
export function resetDemo() { challenge = undefined; proof = undefined; state = initial(); listeners.forEach(listener => listener()); }
export function resetDemoOrder() { challenge = undefined; proof = undefined; update({ status: 'OUT_FOR_DELIVERY', accepted: false, deliveryRecorded: false, rewardPaise: 0, orderEvents: [] }); }
export function partnerStep(action: 'CONSENT' | 'CONTACT' | 'DOCUMENT' | 'SUBMIT' | 'PROVIDER_UNAVAILABLE' | 'APPROVE' | 'REJECT' | 'MORE_INFO' | 'RETRY' | 'ACTIVATE' | 'DEACTIVATE', reason = '') {
  if (action === 'CONSENT' && state.verification === 'NOT_STARTED') return audit('Consent v1 accepted for synthetic demonstration', 'APPLICANT', { consent: true, verification: 'CONTACT_PENDING' });
  if (!state.consent) fail('Consent is required before continuing.');
  if (action === 'PROVIDER_UNAVAILABLE' && state.verification === 'DOCUMENT_READY') return audit('Simulated provider unavailable; manual review available', 'DEMO_PROVIDER', {});
  const transitions: Partial<Record<typeof action, [VerificationState[], VerificationState]>> = {
    CONTACT: [['CONTACT_PENDING'], 'CONTACT_VERIFIED'], DOCUMENT: [['CONTACT_VERIFIED'], 'DOCUMENT_READY'], SUBMIT: [['DOCUMENT_READY'], 'PENDING_REVIEW'],
    APPROVE: [['PENDING_REVIEW'], 'APPROVED'], REJECT: [['PENDING_REVIEW'], 'REJECTED'], MORE_INFO: [['PENDING_REVIEW'], 'NEEDS_INFORMATION'], RETRY: [['NEEDS_INFORMATION', 'REJECTED'], 'CONTACT_VERIFIED'],
  };
  if (action === 'ACTIVATE' || action === 'DEACTIVATE') {
    if (state.verification !== 'APPROVED') fail('Review approval is required before activation.');
    return audit(action === 'ACTIVATE' ? 'Demo partner activated' : 'Demo partner deactivated', 'DEMO_REVIEWER', { active: action === 'ACTIVATE' });
  }
  const transition = transitions[action];
  if (!transition || !transition[0].includes(state.verification)) fail('This step is not permitted from the current demo state.');
  const reviewer = ['APPROVE', 'REJECT', 'MORE_INFO'].includes(action);
  if (reviewer && !reason) fail('A reviewer reason is required.');
  audit(`${action}${reason ? `: ${reason}` : ''}`, reviewer ? 'DEMO_REVIEWER' : action === 'SUBMIT' ? 'DEMO_PROVIDER' : 'APPLICANT', { verification: transition[1], active: false });
}
const outcomes: DeliveryOutcome[] = ['DELIVERY_ATTEMPTED', 'CUSTOMER_UNAVAILABLE', 'CUSTOMER_REJECTED', 'ADDRESS_ISSUE', 'DELIVERED_VERIFIED'];
const actions: CustomerAction[] = ['ACCEPT', 'REJECT', 'REQUEST_REDELIVERY'];
function eligible() { if (!['OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED'].includes(state.status)) fail('This demo link is no longer eligible for an action.', 404); }
export const demoWorkflowApi: WorkflowApi = {
  async preview(kind) { return { orderReference: 'UL-DEMO-ORDER-001', status: state.status, allowedActions: ['OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED'].includes(state.status) ? actions : [], permittedOutcomes: kind === 'delivery' && state.status === 'OUT_FOR_DELIVERY' && state.active && state.verification === 'APPROVED' ? outcomes : [] }; },
  async requestOtp() {
    eligible();
    if (challenge && Date.now() - challenge.requestedAt < 60_000) fail('Wait 60 seconds before requesting another demo code.', 429);
    challenge = { id: `DEMO-CHALLENGE-${Date.now()}`, expires: Date.now() + 300_000, requestedAt: Date.now(), attempts: 0 }; proof = undefined;
    return { challengeId: challenge.id, expiresAt: new Date(challenge.expires).toISOString(), devCode: '246810', demoLabel: 'DEMO TEST OTP — no SMS sent' };
  },
  async verifyOtp(_token, id, code) {
    eligible();
    if (!challenge || challenge.id !== id || challenge.expires <= Date.now() || challenge.attempts >= 5) fail('Demo code expired or attempts exhausted. Request a new code.', 400);
    challenge.attempts++;
    if (code !== '246810') fail('Incorrect demo OTP.', 400);
    proof = { token: `DEMO-PROOF-${Date.now()}`, expires: Date.now() + 900_000 };
    return { verificationToken: proof.token, expiresAt: new Date(proof.expires).toISOString() };
  },
  async decide(_token, verificationToken, body) {
    eligible();
    if (!proof || proof.token !== verificationToken || proof.expires <= Date.now()) fail('Verify again before recording a decision.', 401);
    if (body.action === 'REJECT' && !body.reasonCode) fail('Choose a rejection reason.', 400);
    const next: OrderStatus = body.action === 'REJECT' ? 'CUSTOMER_REJECTED' : body.action === 'REQUEST_REDELIVERY' ? 'REDELIVERY_REQUESTED' : state.status;
    update({ status: next, accepted: body.action === 'ACCEPT', orderEvents: [...state.orderEvents, `DEMO · CUSTOMER · ${body.action}${body.reasonCode ? ` · ${body.reasonCode}` : ''}`] });
    proof = undefined; return { order: { status: next } };
  },
  async deliver(_token, body) {
    if (!state.active || state.verification !== 'APPROVED') fail('Only an active, demo-approved partner can record this simulated attempt.', 403);
    if (state.deliveryRecorded && body.outcome === 'DELIVERED_VERIFIED') return { order: { status: state.status } };
    if (state.status !== 'OUT_FOR_DELIVERY') fail('Demo delivery is not eligible from the current status.');
    if (body.outcome === 'DELIVERED_VERIFIED' && !state.accepted) fail('Customer OTP acceptance is required before a verified handoff.');
    const status: OrderStatus = body.outcome === 'DELIVERED_VERIFIED' ? 'DELIVERED_VERIFIED' : body.outcome === 'DELIVERY_ATTEMPTED' ? 'DELIVERY_ATTEMPTED' : body.outcome === 'CUSTOMER_REJECTED' ? 'CUSTOMER_REJECTED' : 'DELIVERY_FAILED';
    update({ status, deliveryRecorded: status === 'DELIVERED_VERIFIED', rewardPaise: status === 'DELIVERED_VERIFIED' ? 500 : 0, orderEvents: [...state.orderEvents, `DEMO · DELIVERY · ${body.outcome}${body.reasonCode ? ` · ${body.reasonCode}` : ''}`] });
    return { order: { status } };
  },
};
