// @vitest-environment jsdom
import { useCallback } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useResource } from './useResource';

afterEach(cleanup);
it('ignores a superseded response even when its transport does not honor cancellation', async () => {
  const pending: Record<string, (value: string) => void> = {};
  function Example({ id }: { id: string }) {
    const load = useCallback(() => new Promise<string>(resolve => { pending[id] = resolve; }), [id]);
    const resource = useResource(id, load);
    return <p>{resource.loading ? 'Loading' : resource.data}</p>;
  }
  const view = render(<Example id="old" />); view.rerender(<Example id="new" />);
  await act(async () => pending.new('Current response'));
  expect(screen.getByText('Current response')).toBeTruthy();
  await act(async () => pending.old('Stale response'));
  expect(screen.queryByText('Stale response')).toBeNull();
});
