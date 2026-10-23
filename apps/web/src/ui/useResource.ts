import { useEffect, useState } from 'react';
import { errText } from './common';

/** The key identifies the request. Callers memoize loaders with useCallback. */
export function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; revision: number; data?: T; error?: string }>({ key: '', revision: -1 });
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, revision, data });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, revision, error: errText(error) });
    });
    return () => controller.abort();
  }, [key, revision, load]);
  const current = state.key === key && state.revision === revision;
  return { data: current ? state.data : undefined, error: current ? state.error : undefined, loading: !current, reload: () => setRevision(value => value + 1) };
}
