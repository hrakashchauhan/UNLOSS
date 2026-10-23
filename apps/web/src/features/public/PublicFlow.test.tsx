// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PublicFlow } from './PublicFlow';
import { PartnerDemo } from '../demo/PartnerDemo';
import { resetDemo, partnerStep } from '../demo/store';
import { liveWorkflowApi } from './workflowApi';

beforeEach(resetDemo);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function verifyCustomer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Request verification code' }));
  fireEvent.change(await screen.findByLabelText('Six-digit code'), { target: { value: '246810' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
  await screen.findByRole('heading', { name: '2. Record your decision' });
}
it('completes a synthetic OTP acceptance without any live network request', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><PublicFlow kind="customer" token="" demo /></MemoryRouter>);
  await verifyCustomer();
  fireEvent.change(screen.getByLabelText('Your decision'), { target: { value: 'ACCEPT' } });
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  expect(await screen.findByText(/Acceptance recorded/)).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
});
it('records a reasoned customer rejection and redelivery request in separate demo runs', async () => {
  for (const action of ['REJECT', 'REQUEST_REDELIVERY']) {
    resetDemo(); render(<MemoryRouter><PublicFlow kind="customer" token="" demo /></MemoryRouter>); await verifyCustomer();
    fireEvent.change(screen.getByLabelText('Your decision'), { target: { value: action } });
    if (action === 'REJECT') fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'PACKAGE_DAMAGED' } });
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    expect(await screen.findByText(action === 'REJECT' ? /Rejection recorded/ : /Redelivery requested\./)).toBeTruthy(); cleanup();
  }
});
it('shows the demo handoff rejection when no OTP acceptance exists', async () => {
  partnerStep('CONSENT'); partnerStep('CONTACT'); partnerStep('DOCUMENT'); partnerStep('SUBMIT'); partnerStep('APPROVE', 'Synthetic evidence'); partnerStep('ACTIVATE');
  render(<MemoryRouter><PublicFlow kind="delivery" token="" demo /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('What happened?'), { target: { value: 'DELIVERED_VERIFIED' } });
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Customer OTP acceptance is required');
});
it('provides recoverable invalid/expired link feedback and makes no automatic mutation', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { code: 'TOKEN_INVALID', message: 'Token is invalid' } }, { status: 404 })); vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><PublicFlow kind="delivery" token="invalid-token" /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('expired');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  expect(fetchMock.mock.calls.every(([, options]) => !options.method)).toBe(true);
});
it('uses the exact live OTP and decision routes and scoped proof header', async () => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ order: { status: 'OUT_FOR_DELIVERY' } }))); vi.stubGlobal('fetch', fetchMock);
  await liveWorkflowApi.requestOtp('opaque/token'); await liveWorkflowApi.verifyOtp('opaque/token', 'challenge', '123456');
  await liveWorkflowApi.decide('opaque/token', 'proof', { action: 'ACCEPT', reasonCode: null, note: null });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/customer/opaque%2Ftoken/request-otp', '/api/customer/opaque%2Ftoken/verify-otp', '/api/customer/opaque%2Ftoken/decision']);
  expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('X-Customer-Verification')).toBe('proof');
});
it('guides consent, fictional contact, document review, activation, and deletion without uploads', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const { container } = render(<MemoryRouter><PartnerDemo /></MemoryRouter>);
  expect((screen.getByRole('button', { name: 'Agree and start demo' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Agree and start demo' }));
  fireEvent.change(screen.getByLabelText('Demo contact code'), { target: { value: 'DEMO-OK' } }); fireEvent.click(screen.getByRole('button', { name: 'Verify demo contact' }));
  fireEvent.change(screen.getByLabelText('Synthetic evidence type'), { target: { value: 'letter' } }); fireEvent.click(screen.getByRole('button', { name: 'Load synthetic document' }));
  expect(container.querySelector('input[type=file]')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Simulate provider failure' })); expect(screen.getByRole('alert').textContent).toContain('unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Submit to demo manual review' })); fireEvent.change(screen.getByLabelText('Reviewer reason'), { target: { value: 'Consistent synthetic employer evidence' } }); fireEvent.click(screen.getByRole('button', { name: 'Approve demo review' })); fireEvent.click(screen.getByRole('button', { name: 'Activate demo partner' }));
  expect(screen.getByRole('link', { name: /Open simulated delivery/ })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent & delete demo' }));
  expect(screen.getByRole('heading', { name: '1. Privacy & consent' })).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
});
