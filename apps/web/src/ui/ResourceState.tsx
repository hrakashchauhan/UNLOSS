import { ErrorBox } from './common';

export function ResourceState({ loading, error, retry, label = 'records' }: { loading: boolean; error?: string; retry: () => void; label?: string }) {
  if (loading) return <div className="loading-row" role="status">Loading {label}…</div>;
  if (error) return <div className="inset"><ErrorBox message={error} /><button className="button subtle" onClick={retry}>Try again</button></div>;
  return null;
}
