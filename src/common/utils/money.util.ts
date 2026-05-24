const MONEY_PRECISION_FACTOR = 100;

const MONEY_KEYS = new Set([
  'amount',
  'revenue',
  'subtotal',
  'discountTotal',
  'grandTotal',
  'lineTotal',
  'unitPrice',
  'discountAmount',
  'totalRevenue',
  'totalDebit',
  'totalCredit',
  'totalReceivable',
  'pendingPayments',
  'receivedPayments',
  'netAmount',
  'netBalance',
  'absoluteAmount',
  'balance',
  'previousBalance',
  'orderImpact',
  'netPayable',
  'currentOrderBill',
  'balanceImpact',
]);

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Math.round((value + Number.EPSILON) * MONEY_PRECISION_FACTOR) / MONEY_PRECISION_FACTOR;
}

/** Fixed two-decimal string for API responses (e.g. 250.5 → "250.50"). */
export function formatMoneyDisplay(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  return roundMoney(value).toFixed(2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function formatMoneyFieldsDeep<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => formatMoneyFieldsDeep(item)) as T;
  }

  if (!isPlainObject(input)) {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && MONEY_KEYS.has(key)) {
      output[key] = formatMoneyDisplay(value);
      continue;
    }

    output[key] = formatMoneyFieldsDeep(value);
  }

  return output as T;
}
