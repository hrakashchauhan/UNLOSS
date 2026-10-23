import { useEffect, useState } from 'react';
import { api, type OrderStatus } from '../../api';
import { ErrorBox, Status, errText } from '../../ui/common';

/** Read-only until token eligibility, transition validation, and response privacy are enforced by the API. */
export function PublicFlow({ kind, token }: { kind: 'delivery' | 'customer'; token: string }) {
  const [preview, setPreview] = useState<{ orderReference: string; status: OrderStatus } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api<{ orderReference: string; status: OrderStatus }>('/' + kind + '/' + encodeURIComponent(token), { signal: controller.signal })
      .then(setPreview).catch(cause => { if (cause?.name !== 'AbortError') setError(errText(cause)); });
    return () => controller.abort();
  }, [kind, token]);

  return <div className="public-screen"><div className="public-card">
    <div className="brand public-brand"><div className="brand-mark">u</div><span>unloss.</span></div>
    <div className="eyebrow">{kind === 'delivery' ? 'DELIVERY WORKFLOW' : 'CUSTOMER VERIFICATION'}</div>
    <h1>{error ? 'Link unavailable' : preview ? 'Order link' : 'Checking link…'}</h1>
    {error ? <ErrorBox message={error} /> : preview ? <>
      <p className="muted">Order {preview.orderReference}</p>
      <div className="public-status"><span>Current confirmed status</span><Status status={preview.status} /></div>
      <p className="notice">This link does not confirm physical delivery. Actions are paused until the backend validates eligibility and returns only public-safe fields.</p>
      <button className="button full" disabled title="Awaiting backend eligibility and privacy fixes">Actions temporarily unavailable</button>
    </> : <p role="status">Loading order link…</p>}
  </div></div>;
}
