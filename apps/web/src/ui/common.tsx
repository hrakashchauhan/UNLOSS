import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type OrderStatus } from '../api';

export const pretty = (value: string) => value.toLowerCase().split('_').map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ');

export function Status({ status }: { status: OrderStatus }) {
  const tone = status === 'DELIVERED_VERIFIED' ? 'green' :
    ['DELIVERY_FAILED', 'CUSTOMER_REJECTED', 'CANCELLED'].includes(status) ? 'red' :
    ['OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED'].includes(status) ? 'blue' : 'gray';
  return <span className={`status ${tone}`}><i aria-hidden="true" />{pretty(status)}</span>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error-box" role="alert"><span aria-hidden="true">!</span>{message}</div>;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div aria-hidden="true">{icon}</div><b>{title}</b><p>{text}</p>{action}</div>;
}

export function PageHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="muted">{text}</p></div></div>;
}

export function BackLink() { return <Link className="back-link" to="/orders">‹ Back to orders</Link>; }

export function Pagination({ page, size, total, onChange }: { page: number; size: number; total: number; onChange: (value: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / size));
  return <div className="pagination" aria-label="Results pagination"><small>{total ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total}` : '0 results'}</small><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button><span aria-live="polite">Page {page} of {lastPage}</span><button aria-label="Next page" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>›</button></div></div>;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return !value || Number.isNaN(+date) ? '—' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function errText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') return error.message;
    if (error.status === 401) return 'Session expired or verification is required. Please sign in or verify again.';
    if (error.status === 404) return 'This resource is unavailable or the link has expired.';
    return `${error.message}${error.requestId ? ` Reference: ${error.requestId}.` : ''}`;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
