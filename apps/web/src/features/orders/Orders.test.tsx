// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import jsQR from 'jsqr';
import { OrdersPage, Timeline, validateOrder } from './Orders';
import { QrSheet, safeQrUrl, TokenCard } from './QrSheet';
import type { CreateOrderRequest, Event, OrderCreated, RawOrder } from '../../api';
import { normalizeOrder } from '../../api';

const raw: RawOrder = { id: 'order-1', sellerId: 'seller-1', sellerReference: 'TEST-ORDER', status: 'CREATED', customerName: 'Test Recipient', customerPhone: '+919000000000', addressLine1: 'Test address', addressLine2: null, city: 'Test city', state: 'Test state', postalCode: '000000', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const created: OrderCreated = { order: normalizeOrder(raw), qr: { deliveryUrl: 'https://unloss.example/delivery/test-delivery-token', customerUrl: 'https://unloss.example/customer/test-customer-token' } };
vi.mock('../parcels/ParcelWorkspace', () => ({ ParcelPanel: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('rejects whitespace-only order data and malformed phone numbers', () => {
  const body: CreateOrderRequest = { customer: { name: '  ', phone: '+919000000000' }, deliveryAddress: { line1: 'A', city: 'C', state: 'S', postalCode: 'P' } };
  expect(validateOrder(body)).toContain('Spaces');
  body.customer.name = 'Test'; body.customer.phone = '9000000000'; expect(validateOrder(body)).toContain('international');
});

it('creates an order with trimmed contract fields, prevents duplicate submits, and displays the two QR codes', async () => {
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><OrdersPage id="new" /></MemoryRouter>);
  for (const [label, value] of [['Customer name', ' Test Recipient '], ['Phone number', '+919000000000'], ['Address line 1', ' Test address '], ['City', 'Test city'], ['State', 'Test state'], ['Postal code', '000000']]) fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create order' }));
  expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const options = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(String(options.body)).customer.name).toBe('Test Recipient');
  finish(Response.json({ order: raw, qr: created.qr }, { status: 201 }));
  expect(await screen.findByRole('heading', { name: 'Delivery QR' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Customer QR' })).toBeTruthy();
});

it('decodes both rendered SVG QR matrices back to the exact purpose-specific URLs', () => {
  const { container } = render(<MemoryRouter><QrSheet result={created} /></MemoryRouter>);
  const decoded = [...container.querySelectorAll('svg')].map(svg => {
    const modules = Number(svg.getAttribute('viewBox')!.split(' ')[2]), scale = 6, width = modules * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    const path = svg.querySelectorAll('path')[1].getAttribute('d')!;
    for (const match of path.matchAll(/M(\d+)[ ,](\d+)\s*h(\d+)v1H\d+z/g)) {
      const [, xs, ys, count] = match;
      for (let y = Number(ys) * scale; y < (Number(ys) + 1) * scale; y++) for (let x = Number(xs) * scale; x < (Number(xs) + Number(count)) * scale; x++) { const offset = (y * width + x) * 4; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0; }
    }
    return jsQR(pixels, width, width)?.data;
  });
  expect(decoded).toEqual([created.qr.deliveryUrl, created.qr.customerUrl]);
  expect(safeQrUrl('javascript:alert(1)', 'delivery')).toBeNull();
  expect(safeQrUrl(created.qr.customerUrl, 'delivery')).toBeNull();
});

it('downloads the generated SVG through a connected link and keeps its blob URL alive briefly', () => {
  const descriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const createObjectURL = vi.fn(() => 'blob:unloss-qr');
  const revokeObjectURL = vi.fn();
  vi.useFakeTimers();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true);
    expect(this.download).toBe('unloss-delivery-qr.svg');
  });
  try {
    render(<TokenCard purpose="delivery" url={created.qr.deliveryUrl} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download SVG' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('download started');
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:unloss-qr');
  } finally {
    vi.useRealTimers();
    click.mockRestore();
    if (descriptor) Object.defineProperty(URL, 'createObjectURL', descriptor);
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
    else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
});

it('opens the browser print dialog for saving the generated QR sheet as PDF', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  render(<MemoryRouter><QrSheet result={created} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Print / save PDF' }));
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
});

it('sends search/filter/pagination to the contract without displaying stale results', async () => {
  const fetchMock = vi.fn((url: string) => Promise.resolve(Response.json({ items: [{ ...raw, sellerReference: url.includes('q=missing') ? 'NEW-RESULT' : 'OLD-RESULT' }], page: url.includes('page=2') ? 2 : 1, pageSize: 25, total: 26 })));
  vi.stubGlobal('fetch', fetchMock); render(<MemoryRouter><OrdersPage /></MemoryRouter>);
  await screen.findByText('OLD-RESULT'); fireEvent.change(screen.getByRole('textbox', { name: 'Search orders' }), { target: { value: 'missing' } }); fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(screen.queryByText('OLD-RESULT')).toBeNull(); await screen.findByText('NEW-RESULT');
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter orders by status' }), { target: { value: 'DELIVERY_FAILED' } });
  await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('status=DELIVERY_FAILED'));
  await screen.findByText('NEW-RESULT'); fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('page=2'));
});

it('shows backend transition errors without changing the confirmed status or exposing seller completion', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/transitions') ? Response.json({ error: { code: 'INVALID_TRANSITION', message: 'Order changed; refresh and try again.' } }, { status: 409 }) : Response.json({ order: { ...raw, status: 'DELIVERY_FAILED' }, events: [] }))));
  render(<MemoryRouter><OrdersPage id="order-1" /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Order details' });
  expect(screen.queryByRole('option', { name: 'Delivered Verified' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Next status' }), { target: { value: 'RETURN_INITIATED' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: 'ADDRESS_INCORRECT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record change' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Order changed');
  expect(screen.getByText('Delivery Failed')).toBeTruthy();
});

it('sorts the timeline chronologically and labels actor/source/reason', () => {
  const base: Event = { id: 'event-1', orderId: 'order-1', eventType: 'CREATED', fromStatus: null, toStatus: 'CREATED', actorType: 'SELLER', actorId: 'seller-1', reasonCode: null, note: null, source: 'MANUAL', createdAt: '2026-10-01T00:00:00Z' };
  render(<Timeline events={[{ ...base, id: 'event-2', eventType: 'CUSTOMER_REJECTED', actorType: 'CUSTOMER', source: 'DEMO', reasonCode: 'PACKAGE_DAMAGED', createdAt: '2026-10-02T00:00:00Z' }, base]} />);
  const rows = screen.getAllByRole('listitem'); expect(rows[0].textContent).toContain('Created'); expect(rows[1].textContent).toContain('Customer-reported reason: Package Damaged'); expect(rows[1].textContent).toContain('Demo');
});
