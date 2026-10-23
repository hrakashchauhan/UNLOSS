import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { integrationDatabase } from './integration-helpers.js';
import { listen } from './helpers.js';

export const orderInput = { sellerReference: 'SYNTHETIC-WORKFLOW', customer: { name: 'Synthetic Customer', phone: '+919999999999' }, deliveryAddress: { line1: 'Synthetic address', city: 'Test City', state: 'Test State', postalCode: '000000' } };
export async function workflowFixture(demo = true) {
  const { prisma, config: initial } = integrationDatabase();
  const config = { ...initial, demo };
  const password = randomUUID();
  const seller = await prisma.seller.create({ data: { email: `${randomUUID()}@unloss.local`, passwordHash: await bcrypt.hash(password, 4), name: 'Synthetic Seller' } });
  const server = await listen(createApp({ config, prisma, logger: createLogger(() => {}) }));
  const headers = { Origin: config.appOrigin, 'Content-Type': 'application/json' };
  const login = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: seller.email, password }) });
  if (login.status !== 200) throw new Error(`Fixture login failed: ${login.status}`);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const request = (path: string, body?: unknown, authenticated = true, extra: Record<string,string> = {}) => fetch(`${server.url}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(authenticated ? { Cookie: cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const create = async () => { const response = await request('/orders', orderInput); if (response.status !== 201) throw new Error('Fixture order failed'); return response.json(); };
  const transition = (id: string, toStatus: string, reasonCode?: string) => request(`/orders/${id}/transitions`, { toStatus, reasonCode });
  const dispatch = async (id: string) => {
    for (const state of ['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY']) {
      const result = await transition(id, state); if (result.status !== 200) throw new Error(`Fixture dispatch failed: ${result.status}`);
    }
  };
  return { prisma, config, seller, server, request, create, transition, dispatch,
    async close() {
      await server.close();
      await prisma.ledgerEntry.deleteMany({ where: { sellerId: seller.id } });
      await prisma.notification.deleteMany({ where: { sellerId: seller.id } });
      await prisma.order.deleteMany({ where: { sellerId: seller.id } });
      await prisma.seller.delete({ where: { id: seller.id } });
      await prisma.$disconnect();
    },
  };
}
