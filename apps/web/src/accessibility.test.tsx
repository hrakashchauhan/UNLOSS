// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { OrdersPage } from './features/orders/Orders';
import { PartnerDemo } from './features/demo/PartnerDemo';

afterEach(cleanup);
it.each(['order', 'partner'])('has no axe structural accessibility violations in the %s form', async kind => {
  const { container } = render(<MemoryRouter><main>{kind === 'order' ? <OrdersPage id="new" /> : <PartnerDemo embedded />}</main></MemoryRouter>);
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations.map(violation => ({ id: violation.id, description: violation.description, nodes: violation.nodes.map(node => node.html) }))).toEqual([]);
});
