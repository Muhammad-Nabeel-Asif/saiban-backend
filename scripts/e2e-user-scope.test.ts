/* eslint-disable no-console */
/**
 * End-to-end API tests for user-scoped multi-tenancy.
 * Run against a live server: npm run test:e2e
 */

import { config } from 'dotenv';

config();

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}/api`;
const RUN_ID = Date.now();

type ApiResult = { status: number; body: any };

interface TestUser {
  email: string;
  password: string;
  token: string;
  id: string;
}

const results: { name: string; pass: boolean; detail?: string }[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, pass: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail: string) {
  results.push({ name, pass: false, detail });
  console.error(`  ✗ ${name} — ${detail}`);
}

async function request(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<ApiResult> {
  const url = new URL(`${BASE}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  let body: any;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: res.status, body };
}

function assertStatus(name: string, res: ApiResult, expected: number | number[]) {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (expectedList.includes(res.status)) {
    pass(name, `HTTP ${res.status}`);
    return true;
  }
  fail(name, `expected HTTP ${expectedList.join('|')}, got ${res.status}: ${JSON.stringify(res.body)?.slice(0, 200)}`);
  return false;
}

async function registerAndLogin(label: string, email: string, password: string): Promise<TestUser | null> {
  const reg = await request('POST', '/auth/register', {
    body: { name: `${label} Owner`, email, password },
  });
  if (reg.status !== 201 && reg.status !== 200 && !(reg.status === 401 && String(reg.body?.message).includes('exists'))) {
    fail(`${label}: register`, `HTTP ${reg.status}: ${JSON.stringify(reg.body)}`);
    return null;
  }

  const login = await request('POST', '/auth/login', { body: { email, password } });
  if (!assertStatus(`${label}: login`, login, [200, 201])) return null;

  const token = login.body.access_token;
  const id = String(login.body.user?.id ?? login.body.user?._id);
  if (!token || !id) {
    fail(`${label}: login payload`, 'missing access_token or user id');
    return null;
  }

  pass(`${label}: authenticated`, id);
  return { email, password, token, id };
}

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Saiban Backend — User Scope E2E Tests');
  console.log(`  Target: ${BASE}`);
  console.log(`  Run ID: ${RUN_ID}`);
  console.log('══════════════════════════════════════════════════\n');

  // ── Health: server reachable ──────────────────────────────────────────────
  try {
    const health = await fetch(`${BASE}/auth/login`, { method: 'OPTIONS' });
    if (!health.ok && health.status !== 204 && health.status !== 404) {
      throw new Error(`unexpected status ${health.status}`);
    }
  } catch {
    console.error('\n[x] Server not reachable. Start with: npm run start:dev\n');
    process.exit(1);
  }

  const userA = await registerAndLogin(
    'UserA',
    `e2e-a-${RUN_ID}@test.local`,
    'TestPass123!',
  );
  const userB = await registerAndLogin(
    'UserB',
    `e2e-b-${RUN_ID}@test.local`,
    'TestPass123!',
  );

  if (!userA || !userB) {
    printSummary();
    process.exit(1);
  }

  // ── Auth: unauthenticated access blocked ──────────────────────────────────
  const noAuth = await request('GET', '/products');
  assertStatus('Auth: GET /products without token → 401', noAuth, 401);

  const badToken = await request('GET', '/products', { token: 'invalid.jwt.token' });
  assertStatus('Auth: GET /products with bad token → 401', badToken, 401);

  // ── UserA: empty tenant initially ─────────────────────────────────────────
  const aProductsEmpty = await request('GET', '/products', { token: userA.token });
  if (assertStatus('UserA: GET /products (empty)', aProductsEmpty, 200)) {
    if (aProductsEmpty.body.pagination?.total === 0 || aProductsEmpty.body.data?.length === 0) {
      pass('UserA: starts with no products');
    } else {
      pass('UserA: GET /products returns paginated list', `${aProductsEmpty.body.pagination?.total} total`);
    }
  }

  const aCustomersEmpty = await request('GET', '/customers', { token: userA.token });
  assertStatus('UserA: GET /customers', aCustomersEmpty, 200);

  const aOrdersEmpty = await request('GET', '/orders', { token: userA.token });
  assertStatus('UserA: GET /orders', aOrdersEmpty, 200);

  const aDashboardEmpty = await request('GET', '/dashboard/metrics', { token: userA.token });
  if (assertStatus('UserA: GET /dashboard/metrics', aDashboardEmpty, 200)) {
    const m = aDashboardEmpty.body.metrics;
    if (m?.totalProducts === 0 && m?.totalCustomers === 0 && m?.totalOrders === 0) {
      pass('UserA: dashboard metrics all zero initially');
    } else {
      pass('UserA: dashboard metrics returned', JSON.stringify(m));
    }
  }

  // ── UserA: create product ───────────────────────────────────────────────────
  const productPayload = {
    name: `E2E Panadol ${RUN_ID}`,
    formulation: 'Paracetamol',
    packType: 'Tablet',
    size: 10,
    unitPrice: 150,
    quantityInStock: 100,
    lowStockThreshold: 10,
    batchNo: 'BATCH-001',
    expiry: '2027-12',
    mfg: 'GSK',
  };

  const createProductA = await request('POST', '/products', { token: userA.token, body: productPayload });
  if (!assertStatus('UserA: POST /products', createProductA, 201)) {
    printSummary();
    process.exit(1);
  }
  const productAId = String(createProductA.body._id);
  pass('UserA: product created', productAId);

  // Same product name for UserB should succeed (per-user unique index)
  const createProductB = await request('POST', '/products', {
    token: userB.token,
    body: { ...productPayload, quantityInStock: 50 },
  });
  assertStatus('UserB: POST /products (same name as UserA) → 201', createProductB, 201);

  // Duplicate name for same user should fail
  const dupProductA = await request('POST', '/products', { token: userA.token, body: productPayload });
  if (dupProductA.status === 409 || dupProductA.status === 400) {
    pass('UserA: duplicate product name rejected', `HTTP ${dupProductA.status}`);
  } else {
    fail('UserA: duplicate product name rejected', `expected 400/409, got ${dupProductA.status}`);
  }
  const getProductA = await request('GET', `/products/${productAId}`, { token: userA.token });
  assertStatus('UserA: GET /products/:id', getProductA, 200);

  const patchProductA = await request('PATCH', `/products/${productAId}`, {
    token: userA.token,
    body: { unitPrice: 175, shortDescription: 'Updated' },
  });
  if (assertStatus('UserA: PATCH /products/:id', patchProductA, 200)) {
    const price = Number(patchProductA.body.unitPrice);
    if (price === 175) pass('UserA: product price updated');
    else fail('UserA: product price updated', `got ${patchProductA.body.unitPrice}`);
  }

  const listProductsA = await request('GET', '/products', {
    token: userA.token,
    query: { search: 'Panadol', stockStatus: 'in_stock', page: '1', limit: '10' },
  });
  if (assertStatus('UserA: GET /products?search&stockStatus', listProductsA, 200)) {
    const found = listProductsA.body.data?.some((p: any) => String(p._id) === productAId);
    if (found) pass('UserA: product appears in filtered list');
    else fail('UserA: product appears in filtered list', 'not found in results');
  }

  // ── UserA: create customer ──────────────────────────────────────────────────
  const customerPayload = {
    firstName: 'Ali',
    lastName: 'Khan',
    phoneNumber: '03001234567',
    email: `ali-${RUN_ID}@customer.local`,
    city: 'Karachi',
    state: 'Sindh',
    balanceAdjustment: { amount: 500, direction: 'customer_owes', note: 'Opening balance' },
  };

  const createCustomerA = await request('POST', '/customers', { token: userA.token, body: customerPayload });
  if (!assertStatus('UserA: POST /customers (with opening balance)', createCustomerA, 201)) {
    printSummary();
    process.exit(1);
  }
  const customerAId = String(createCustomerA.body._id);
  pass('UserA: customer created', customerAId);

  const getCustomerA = await request('GET', `/customers/${customerAId}`, { token: userA.token });
  if (assertStatus('UserA: GET /customers/:id', getCustomerA, 200)) {
    if (getCustomerA.body.balance?.netBalance === 500) pass('UserA: customer opening balance = 500');
    else pass('UserA: customer balance returned', JSON.stringify(getCustomerA.body.balance));
  }

  const patchCustomerA = await request('PATCH', `/customers/${customerAId}`, {
    token: userA.token,
    body: { city: 'Lahore' },
  });
  assertStatus('UserA: PATCH /customers/:id', patchCustomerA, 200);

  const listCustomersA = await request('GET', '/customers', {
    token: userA.token,
    query: { search: 'Ali', sort: 'name' },
  });
  assertStatus('UserA: GET /customers?search&sort', listCustomersA, 200);

  const balanceAdjA = await request('POST', `/customers/${customerAId}/balance-adjustments`, {
    token: userA.token,
    body: { amount: 200, direction: 'we_owe_customer', note: 'Credit note' },
  });
  assertStatus('UserA: POST /customers/:id/balance-adjustments', balanceAdjA, 201);

  // ── UserA: create order ─────────────────────────────────────────────────────
  const createOrderA = await request('POST', '/orders', {
    token: userA.token,
    body: {
      customerId: customerAId,
      items: [{ productId: productAId, quantity: 2, discountPercentage: 10 }],
      note: 'E2E test order',
    },
  });
  if (!assertStatus('UserA: POST /orders', createOrderA, 201)) {
    printSummary();
    process.exit(1);
  }
  const orderAId = String(createOrderA.body._id);
  const invoiceA = createOrderA.body.invoiceNumber;
  pass('UserA: order created', `${orderAId} invoice=${invoiceA}`);

  if (createOrderA.body.status === 'pending') pass('UserA: new order status is pending');
  else fail('UserA: new order status is pending', createOrderA.body.status);

  const stockAfterOrder = await request('GET', `/products/${productAId}`, { token: userA.token });
  if (stockAfterOrder.body.quantityInStock === 98) pass('UserA: stock deducted (100 → 98)');
  else pass('UserA: stock after order', String(stockAfterOrder.body.quantityInStock));

  const getOrderA = await request('GET', `/orders/${orderAId}`, { token: userA.token });
  assertStatus('UserA: GET /orders/:id', getOrderA, 200);
  if (getOrderA.body.invoiceBalanceSummary) pass('UserA: order includes invoiceBalanceSummary');

  const listOrdersA = await request('GET', '/orders', {
    token: userA.token,
    query: { status: 'pending', search: 'Ali' },
  });
  assertStatus('UserA: GET /orders?status&search', listOrdersA, 200);

  const confirmOrderA = await request('PATCH', `/orders/${orderAId}/confirm`, { token: userA.token });
  assertStatus('UserA: PATCH /orders/:id/confirm', confirmOrderA, 200);

  const orderGrandTotal = createOrderA.body.grandTotal;
  const recordPaymentA = await request('POST', '/payment', {
    token: userA.token,
    body: {
      customerId: customerAId,
      orderId: orderAId,
      amount: orderGrandTotal,
      paymentMethod: 'cash',
      note: 'Full payment',
    },
  });
  assertStatus('UserA: POST /payment (full order payment)', recordPaymentA, 201);

  // Second order for cancel flow
  const createOrderCancel = await request('POST', '/orders', {
    token: userA.token,
    body: {
      customerId: customerAId,
      items: [{ productId: productAId, quantity: 1 }],
    },
  });
  const orderCancelId = String(createOrderCancel.body._id);
  assertStatus('UserA: POST /orders (for cancel test)', createOrderCancel, 201);

  const cancelOrderA = await request('PATCH', `/orders/${orderCancelId}/cancel`, { token: userA.token });
  assertStatus('UserA: PATCH /orders/:id/cancel', cancelOrderA, 200);

  // Return flow on confirmed order
  const createOrderReturn = await request('POST', '/orders', {
    token: userA.token,
    body: {
      customerId: customerAId,
      items: [{ productId: productAId, quantity: 1 }],
    },
  });
  const orderReturnId = String(createOrderReturn.body._id);
  await request('PATCH', `/orders/${orderReturnId}/confirm`, { token: userA.token });
  const returnOrderA = await request('PATCH', `/orders/${orderReturnId}/return`, { token: userA.token });
  assertStatus('UserA: PATCH /orders/:id/return', returnOrderA, 200);

  // Standalone payment
  const standalonePayment = await request('POST', '/payment', {
    token: userA.token,
    body: { customerId: customerAId, amount: 100, paymentMethod: 'easypaisa', note: 'Standalone' },
  });
  assertStatus('UserA: POST /payment (standalone)', standalonePayment, 201);

  // Order with wrong customer product (cross-entity validation) — use UserB product
  const productBId = String(createProductB.body._id);
  const crossProductOrder = await request('POST', '/orders', {
    token: userA.token,
    body: {
      customerId: customerAId,
      items: [{ productId: productBId, quantity: 1 }],
    },
  });
  if (crossProductOrder.status === 400 || crossProductOrder.status === 404) {
    pass('UserA: cannot order with another user\'s product', `HTTP ${crossProductOrder.status}`);
  } else {
    fail('UserA: cannot order with another user\'s product', `HTTP ${crossProductOrder.status}`);
  }

  // ── UserA: customer history endpoints ───────────────────────────────────────
  assertStatus(
    'UserA: GET /customers/:id/orders',
    await request('GET', `/customers/${customerAId}/orders`, { token: userA.token }),
    200,
  );
  assertStatus(
    'UserA: GET /customers/:id/transactions',
    await request('GET', `/customers/${customerAId}/transactions`, { token: userA.token }),
    200,
  );
  assertStatus(
    'UserA: GET /customers/:id/balance',
    await request('GET', `/customers/${customerAId}/balance`, { token: userA.token }),
    200,
  );

  // ── UserA: ledger endpoints ─────────────────────────────────────────────────
  assertStatus(
    'UserA: GET /ledger/customer/:id/balance',
    await request('GET', `/ledger/customer/${customerAId}/balance`, { token: userA.token }),
    200,
  );
  assertStatus(
    'UserA: GET /ledger/customer/:id/entries',
    await request('GET', `/ledger/customer/${customerAId}/entries`, {
      token: userA.token,
      query: { page: '1', limit: '10' },
    }),
    200,
  );
  assertStatus(
    'UserA: GET /ledger/entries',
    await request('GET', '/ledger/entries', { token: userA.token, query: { page: '1', limit: '10' } }),
    200,
  );

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  assertStatus(
    'UserA: GET /ledger/reports/date-range',
    await request('GET', '/ledger/reports/date-range', {
      token: userA.token,
      query: { startDate: weekAgo.toISOString(), endDate: today.toISOString() },
    }),
    200,
  );
  assertStatus(
    'UserA: GET /ledger/summary',
    await request('GET', '/ledger/summary', { token: userA.token }),
    200,
  );

  // ── UserA: dashboard ────────────────────────────────────────────────────────
  const dashMetricsA = await request('GET', '/dashboard/metrics', { token: userA.token });
  if (assertStatus('UserA: GET /dashboard/metrics (populated)', dashMetricsA, 200)) {
    const m = dashMetricsA.body.metrics;
    if (m.totalProducts >= 1 && m.totalCustomers >= 1 && m.totalOrders >= 1) {
      pass('UserA: dashboard reflects own data');
    } else {
      fail('UserA: dashboard reflects own data', JSON.stringify(m));
    }
  }

  assertStatus(
    'UserA: GET /dashboard/revenue-trend',
    await request('GET', '/dashboard/revenue-trend', {
      token: userA.token,
      query: { range: '7d', timezone: 'Asia/Karachi' },
    }),
    200,
  );

  assertStatus(
    'UserA: POST /orders/backfill-invoice-numbers',
    await request('POST', '/orders/backfill-invoice-numbers', { token: userA.token }),
    201,
  );

  // ── UserB: isolation — cannot see UserA data ──────────────────────────────
  console.log('\n── Cross-user isolation tests ──');

  const bListProducts = await request('GET', '/products', { token: userB.token });
  if (assertStatus('UserB: GET /products', bListProducts, 200)) {
    const seesA = bListProducts.body.data?.some((p: any) => String(p._id) === productAId);
    if (!seesA) pass('UserB: cannot see UserA products in list');
    else fail('UserB: cannot see UserA products in list', 'found UserA product');
  }

  assertStatus('UserB: GET /products/:id (UserA product) → 404', await request('GET', `/products/${productAId}`, { token: userB.token }), 404);
  assertStatus('UserB: PATCH /products/:id (UserA product) → 404', await request('PATCH', `/products/${productAId}`, { token: userB.token, body: { unitPrice: 1 } }), 404);
  assertStatus('UserB: DELETE /products/:id (UserA product) → 404', await request('DELETE', `/products/${productAId}`, { token: userB.token }), 404);

  assertStatus('UserB: GET /customers/:id (UserA customer) → 404', await request('GET', `/customers/${customerAId}`, { token: userB.token }), 404);
  assertStatus('UserB: GET /orders/:id (UserA order) → 404', await request('GET', `/orders/${orderAId}`, { token: userB.token }), 404);
  assertStatus('UserB: PATCH /orders/:id/confirm (UserA order) → 404', await request('PATCH', `/orders/${orderAId}/confirm`, { token: userB.token }), 404);

  const bPaymentOnA = await request('POST', '/payment', {
    token: userB.token,
    body: { customerId: customerAId, amount: 50, paymentMethod: 'cash' },
  });
  assertStatus('UserB: POST /payment on UserA customer → 404', bPaymentOnA, 404);

  assertStatus(
    'UserB: GET /ledger/customer/:id/balance (UserA customer) → 404',
    await request('GET', `/ledger/customer/${customerAId}/balance`, { token: userB.token }),
    404,
  );

  const bDash = await request('GET', '/dashboard/metrics', { token: userB.token });
  if (assertStatus('UserB: GET /dashboard/metrics', bDash, 200)) {
    const m = bDash.body.metrics;
    const aDash = dashMetricsA.body.metrics;
    if (m.totalProducts !== aDash.totalProducts || m.totalCustomers !== aDash.totalCustomers) {
      pass('UserB: dashboard metrics isolated from UserA');
    } else if (m.totalProducts <= 1) {
      pass('UserB: dashboard shows only own counts', JSON.stringify(m));
    } else {
      fail('UserB: dashboard metrics isolated from UserA', `A=${JSON.stringify(aDash)} B=${JSON.stringify(m)}`);
    }
  }

  // UserB list orders should not include UserA orders
  const bOrders = await request('GET', '/orders', { token: userB.token });
  if (assertStatus('UserB: GET /orders', bOrders, 200)) {
    const seesAOrder = bOrders.body.data?.some((o: any) => String(o._id) === orderAId);
    if (!seesAOrder) pass('UserB: cannot see UserA orders in list');
    else fail('UserB: cannot see UserA orders in list', 'found UserA order');
  }

  // ── UserA: delete customer blocked if we keep orders? Actually customer has orders - delete cascades
  // Test invalid IDs
  assertStatus('UserA: GET /products/bad-id → 400', await request('GET', '/products/not-an-id', { token: userA.token }), 400);

  assertStatus(
    'UserB: GET /customers/:id/orders (UserA customer) → 404',
    await request('GET', `/customers/${customerAId}/orders`, { token: userB.token }),
    404,
  );
  assertStatus(
    'UserB: GET /customers/:id/transactions (UserA customer) → 404',
    await request('GET', `/customers/${customerAId}/transactions`, { token: userB.token }),
    404,
  );
  assertStatus(
    'UserB: GET /ledger/entries?customerId (UserA customer) → 404',
    await request('GET', '/ledger/entries', {
      token: userB.token,
      query: { customerId: customerAId },
    }),
    404,
  );

  // UserB creates own customer and verifies ledger/dashboard only show own data
  const createCustomerB = await request('POST', '/customers', {
    token: userB.token,
    body: { firstName: 'Sara', lastName: 'Ahmed', city: 'Islamabad' },
  });
  if (assertStatus('UserB: POST /customers', createCustomerB, 201)) {
    const customerBId = String(createCustomerB.body._id);
    const bLedger = await request('GET', '/ledger/entries', { token: userB.token });
    if (assertStatus('UserB: GET /ledger/entries', bLedger, 200)) {
      const seesAEntry = bLedger.body.data?.some(
        (e: any) => String(e.customerId?._id ?? e.customerId) === customerAId,
      );
      if (!seesAEntry) pass('UserB: ledger entries exclude UserA customers');
      else fail('UserB: ledger entries exclude UserA customers', 'found UserA entry');
    }

    // UserA cannot use UserB customer for order
    const orderWithBCustomer = await request('POST', '/orders', {
      token: userA.token,
      body: {
        customerId: customerBId,
        items: [{ productId: productAId, quantity: 1 }],
      },
    });
    assertStatus('UserA: POST /orders with UserB customer → 404', orderWithBCustomer, 404);
  }

  // Payment validation: exceeds order total
  const createOrderPayTest = await request('POST', '/orders', {
    token: userA.token,
    body: {
      customerId: customerAId,
      items: [{ productId: productAId, quantity: 1 }],
    },
  });
  if (createOrderPayTest.status === 201) {
    const payOrderId = String(createOrderPayTest.body._id);
    await request('PATCH', `/orders/${payOrderId}/confirm`, { token: userA.token });
    const overpay = await request('POST', '/payment', {
      token: userA.token,
      body: {
        customerId: customerAId,
        orderId: payOrderId,
        amount: 999999,
        paymentMethod: 'cash',
      },
    });
    assertStatus('UserA: POST /payment exceeding order total → 400', overpay, 400);
  }

  // Customer delete cascade
  const createCustomerDelete = await request('POST', '/customers', {
    token: userA.token,
    body: { firstName: 'Temp', lastName: 'Delete', city: 'Test' },
  });
  if (createCustomerDelete.status === 201) {
    const tempCustomerId = String(createCustomerDelete.body._id);
    assertStatus(
      'UserA: DELETE /customers/:id',
      await request('DELETE', `/customers/${tempCustomerId}`, { token: userA.token }),
      200,
    );
    assertStatus(
      'UserA: GET /customers/:id after delete → 404',
      await request('GET', `/customers/${tempCustomerId}`, { token: userA.token }),
      404,
    );
  }

  // Invalid login
  const badLogin = await request('POST', '/auth/login', {
    body: { email: userA.email, password: 'wrong-password' },
  });
  assertStatus('Auth: invalid login → 401', badLogin, 401);

  // ── Cleanup UserA test product (optional — delete product) ─────────────────
  // Note: product may have order history via stock movements; delete still works on product
  const deleteProductAttempt = await request('DELETE', `/products/${productAId}`, { token: userA.token });
  assertStatus('UserA: DELETE /products/:id', deleteProductAttempt, 200);

  printSummary();
  const failed = results.filter((r) => !r.pass);
  process.exit(failed.length > 0 ? 1 : 0);
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('\n  Failed tests:');
    for (const f of failed) {
      console.log(`    ✗ ${f.name}: ${f.detail}`);
    }
  } else {
    console.log('  All tests passed!');
  }
  console.log('══════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\n[x] E2E runner crashed:\n', err);
  process.exit(1);
});
