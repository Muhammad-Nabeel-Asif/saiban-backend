const MONEY_PRECISION_FACTOR = 100;

const MONEY_KEYS = new Set([
  'amount',
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
  'netAmount',
  'netBalance',
  'absoluteAmount',
  'balance',
]);

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Math.round((value + Number.EPSILON) * MONEY_PRECISION_FACTOR) / MONEY_PRECISION_FACTOR;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function roundMoneyFieldsDeep<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => roundMoneyFieldsDeep(item)) as T;
  }

  if (!isPlainObject(input)) {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && MONEY_KEYS.has(key)) {
      output[key] = roundMoney(value);
      continue;
    }

    output[key] = roundMoneyFieldsDeep(value);
  }

  return output as T;
}
