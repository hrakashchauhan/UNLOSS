// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

it('mounts the application into the Vite root element', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 })));
  await import('./main');
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
});
