import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { OrderStatus, ReasonCode } from '../../api';
import { reasons } from '../../domain';
import { ErrorBox, Status, errText, formatDate, pretty } from '../../ui/common';
import { ResourceState } from '../../ui/ResourceState';
import { useResource } from '../../ui/useResource';
import { DEMO_LABEL, demoWorkflowApi } from '../demo/store';
import { LIVE_PUBLIC_WRITES_READY, liveWorkflowApi, type Challenge, type CustomerAction, type DeliveryOutcome, type Proof, type PublicPreview, type WorkflowApi } from './workflowApi';

export function PublicFlow({ kind, token, demo = false }: { kind: 'delivery' | 'customer'; token: string; demo?: boolean }) {
  const transport = demo ? demoWorkflowApi : liveWorkflowApi;
  const load = useCallback((signal: AbortSignal) => transport.preview(kind, token, signal), [transport, kind, token]);
  const resource = useResource(`${kind}/${token}`, load);
  const [receipt, setReceipt] = useState<{ message: string; preview: PublicPreview } | null>(null);
  const preview = receipt?.preview || resource.data;
  function done(message: string, status: OrderStatus) {
    if (preview) setReceipt({ message, preview: { ...preview, status } });
    // Keep the confirmed POST receipt. Completion/rejection can invalidate further GETs.
  }
  return <main className="public-screen"><div className="public-card workflow-card"><div className="brand public-brand"><div className="brand-mark">u</div><span>unloss.</span></div>
    {demo && <p className="demo-banner">{DEMO_LABEL}<br /><small>Synthetic data in this tab only. No SMS, identity verification, or payout.</small></p>}
    {!demo && preview?.mode === 'demo' && <p className="demo-banner">DATABASE-BACKED LOCAL DEMO<br /><small>Actions are saved as demo events. Test OTP only; no SMS or official partner verification. A QR bearer can exercise this supervised demo.</small></p>}
    <div className="eyebrow">{kind === 'delivery' ? 'DELIVERY WORKFLOW' : 'CUSTOMER VERIFICATION'}</div><h1>{receipt ? 'Outcome recorded' : resource.error ? 'Link unavailable' : kind === 'delivery' ? 'Record a delivery outcome' : 'Your parcel decision'}</h1>
    {!receipt && <ResourceState {...resource} retry={resource.reload} label="order link" />}{preview && <><p>Order <b>{preview.orderReference}</b></p><div className="public-status"><span>Current confirmed status</span><Status status={preview.status} /></div><p className="public-copy">Opening or scanning this link does not prove physical delivery. Only the permitted, verified workflow records an outcome.</p>
      {receipt ? <><p className="notice" role="status">{receipt.message}</p><p className="field-help">This receipt confirms the recorded action. The link may now be closed; the seller can inspect the saved timeline.</p></> : !demo && preview.mode !== 'demo' && !LIVE_PUBLIC_WRITES_READY ? <><p className="notice">Live delivery authorization and verification are unavailable. Contact the seller to arrange the next step.</p><button className="button full" disabled aria-describedby="workflow-blocked">Actions temporarily unavailable</button><p id="workflow-blocked" className="field-help">Required partner and provider integrations are not available. Only the explicitly labelled local demo supports these actions.</p></> : <>
        <button className="button subtle" onClick={resource.reload}>Refresh permitted actions</button>
        {kind === 'customer' ? <CustomerForm preview={preview} token={token} transport={transport} done={done} /> : <><p className="field-help">Refresh after the recipient accepts with OTP to see whether a verified handoff is permitted.</p><DeliveryForm preview={preview} token={token} transport={transport} done={done} /></>}
      </>}
    </>}{demo && <div className="quick-links"><Link to="/demo">Demo activity and reset</Link><Link to={kind === 'delivery' ? '/demo/customer' : '/demo/delivery'}>{kind === 'delivery' ? 'Open customer demo' : 'Open delivery demo'}</Link>{kind === 'delivery' && <Link to="/demo/partners">Complete partner demo verification</Link>}</div>}
  </div></main>;
}

function ReasonFields({ reason, setReason, note, setNote, required, options = reasons }: { reason: ReasonCode | ''; setReason: (value: ReasonCode | '') => void; note: string; setNote: (value: string) => void; required: boolean; options?: readonly ReasonCode[] }) {
  return <>{options.length > 0 && <label>Reason{required ? ' (required)' : ' (optional)'}<select value={reason} onChange={event => setReason(event.target.value as ReasonCode)} required={required}><option value="">Select reason</option>{options.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>}<label>Note (optional)<textarea maxLength={1000} rows={3} value={note} onChange={event => setNote(event.target.value)} /><small className="field-help">Do not include identity documents, passwords, or payment details.</small></label></>;
}
function CustomerForm({ preview, token, transport, done }: { preview: PublicPreview; token: string; transport: WorkflowApi; done: (message: string, status: OrderStatus) => void }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null), [proof, setProof] = useState<Proof | null>(null), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [action, setAction] = useState<CustomerAction | ''>(''), [reason, setReason] = useState<ReasonCode | ''>(''), [note, setNote] = useState('');
  const [now, setNow] = useState(Date.now), [resendAt, setResendAt] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const proofValid = proof && Date.parse(proof.expiresAt) > now;
  const codeValid = challenge && Date.parse(challenge.expiresAt) > now;
  async function requestOtp() {
    if (busy || resendAt > Date.now()) return; setBusy(true); setError('');
    try { setChallenge(await transport.requestOtp(token)); setProof(null); setCode(''); setResendAt(Date.now() + 60_000); } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); if (!challenge || busy) return;
    if (!/^[0-9]{6}$/.test(code)) { setError('Enter the six-digit code.'); return; } setBusy(true); setError('');
    try { setProof(await transport.verifyOtp(token, challenge.challengeId, code)); setCode(''); } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  async function decide(event: FormEvent) {
    event.preventDefault(); if (!proofValid || !action || busy) return;
    if (action === 'REJECT' && !reason) { setError('Choose a rejection reason.'); return; } setBusy(true); setError('');
    try { const result = await transport.decide(token, proof.verificationToken, { action, reasonCode: action === 'REQUEST_REDELIVERY' ? 'CUSTOMER_REQUESTED_REDELIVERY' : reason || null, note: note.trim() || null }); setProof(null); done(action === 'ACCEPT' ? 'Acceptance recorded. An authorized delivery handoff is still required; acceptance alone does not confirm physical delivery.' : action === 'REJECT' ? 'Rejection recorded with your reported reason.' : 'Redelivery requested. A request does not guarantee a delivery date.', result.order.status); }
    catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  if (!preview.allowedActions?.length) return <p className="notice">No customer actions are currently permitted. Contact the seller for assistance.</p>;
  return <>{error && <ErrorBox message={error} />}{!proofValid ? <section><h2>1. Verify with OTP</h2><p className="public-copy">Request a code for the contact method registered on this order.</p>{proof && <p className="notice">Verification expired. Request and verify a new code.</p>}
    <button className="button primary full" disabled={busy || resendAt > now} onClick={requestOtp}>{busy ? 'Please wait…' : resendAt > now ? `Resend in ${Math.ceil((resendAt - now) / 1000)}s` : challenge ? 'Request another code' : 'Request verification code'}</button>
    {challenge && <>{challenge.devCode && <p className="demo-banner"><b>{challenge.demoLabel || 'DEMO TEST OTP'}</b><br />Code: <strong>{challenge.devCode}</strong><br />No real SMS delivery is implied.</p>}<p className="field-help">Expires {formatDate(challenge.expiresAt)}. Up to five verification attempts.</p>{!codeValid && <p className="notice">Code expired. Request another code.</p>}<form className="form-stack" onSubmit={verify}><label>Six-digit code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value)} /></label><button className="button primary" disabled={busy || !codeValid}>Verify code</button></form></>}
  </section> : <form className="form-stack" onSubmit={decide}><h2>2. Record your decision</h2><p className="notice" role="status">OTP verified. Valid until {formatDate(proof.expiresAt)}.</p><fieldset disabled={busy}><label>Your decision<select value={action} required onChange={event => setAction(event.target.value as CustomerAction)}><option value="">Choose a decision</option>{preview.allowedActions.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select></label><ReasonFields reason={reason} setReason={setReason} note={note} setNote={setNote} required={action === 'REJECT'} /><label className="checkbox-label"><input type="checkbox" required />I confirm this decision describes my intended response for this parcel.</label></fieldset><button className="button primary" disabled={busy || !action}>{busy ? 'Recording…' : 'Confirm decision'}</button></form>}</>;
}
function DeliveryForm({ preview, token, transport, done }: { preview: PublicPreview; token: string; transport: WorkflowApi; done: (message: string, status: OrderStatus) => void }) {
  const [outcome, setOutcome] = useState<DeliveryOutcome | ''>(''), [reason, setReason] = useState<ReasonCode | ''>(''), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const reasonOptions: readonly ReasonCode[] = outcome === 'DELIVERED_VERIFIED' ? [] : outcome === 'ADDRESS_ISSUE' ? ['ADDRESS_INCORRECT', 'ADDRESS_INCOMPLETE'] : reasons;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!outcome || busy) return;
    if (!['DELIVERY_ATTEMPTED', 'DELIVERED_VERIFIED'].includes(outcome) && !reason) { setError('Select the reported reason.'); return; }
    if (reason && outcome !== 'DELIVERED_VERIFIED' && !reasonOptions.includes(reason)) { setError('Choose a reason that matches this outcome.'); return; }
    setBusy(true); setError(''); try { const result = await transport.deliver(token, { outcome, reasonCode: outcome === 'DELIVERED_VERIFIED' ? null : reason || null, note: note.trim() || null }); done('Delivery outcome recorded. See the confirmed status above.', result.order.status); } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  if (!preview.permittedOutcomes?.length) return <p className="notice">No delivery action is currently permitted. An eligible order and an active, authorized partner are required.</p>;
  return <form className="form-stack" onSubmit={submit}><h2>Delivery outcome</h2>{error && <ErrorBox message={error} />}<fieldset disabled={busy}><label>What happened?<select required value={outcome} onChange={event => { setOutcome(event.target.value as DeliveryOutcome); setReason(''); setError(''); }}><option value="">Select outcome</option>{preview.permittedOutcomes.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select></label><ReasonFields reason={reason} setReason={setReason} note={note} setNote={setNote} options={reasonOptions} required={!!outcome && !['DELIVERY_ATTEMPTED', 'DELIVERED_VERIFIED'].includes(outcome)} />{outcome === 'DELIVERED_VERIFIED' && <label className="checkbox-label"><input type="checkbox" required />I confirm the parcel handoff was completed. The service must also confirm customer OTP acceptance and eligibility.</label>}</fieldset><button className="button primary" disabled={busy || !outcome}>{busy ? 'Recording…' : 'Record outcome'}</button></form>;
}
