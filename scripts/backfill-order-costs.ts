/* eslint-disable no-console */
/**
 * backfill-order-costs.ts
 *
 * One-time (idempotent) migration that snapshots each order line item's
 * `costPrice` / `lineCost` and recomputes the order-level `costTotal` /
 * `profitTotal`, using each product's CURRENT `purchasePrice`.
 *
 * WHY: orders created before purchase-price tracking shipped have no cost
 * snapshot, so their `costTotal` is `0` and `profitTotal == subtotal`. That
 * makes dashboard charts show a misleading ~100% margin on old buckets. This
 * backfills them so metrics, revenue-trend, and top-products are accurate for
 * the full order history.
 *
 * IMPORTANT: run the PRODUCT cost backfill FIRST so products actually have a
 * real `purchasePrice`:
 *   npm run products:export-costs -- --out costs.csv --missing-only
 *   npm run products:import-costs -- --in costs.csv
 * Then run this. By default, line items whose product still has no cost
 * (`purchasePrice <= 0` / missing) are SKIPPED (not locked to 0), so you can
 * fill product costs later and simply re-run this to converge. Pass
 * `--zero-missing` to instead snapshot `0` for them (they'll show 100% margin
 * until the product cost is filled — matches the handoff pseudocode).
 *
 * Scope:
 *   - All orders with status !== "cancelled".
 *   - Line items missing `costPrice` (null/undefined/absent). Items that already
 *     have a `costPrice` are left untouched (idempotent), including orders
 *     created after the feature shipped.
 *
 * Rules (per item needing backfill):
 *   costPrice = round(product.purchasePrice, 2)
 *   lineCost  = round(costPrice * quantity, 2)
 * Then per order:
 *   costTotal   = round(Σ lineCost, 2)
 *   profitTotal = round(subtotal - costTotal, 2)   // ex-GST, same basis as §2
 * `unitPrice`, `lineTotal`, `subtotal`, `discountTotal`, `grandTotal` are NOT
 * touched.
 *
 * Usage:
 *   # Preview only (no writes) — prints ordersAffected / itemsAffected /
 *   # estimatedTotalCost / estimatedTotalProfit
 *   npm run orders:backfill-costs -- --dry-run
 *
 *   # Apply
 *   npm run orders:backfill-costs
 *
 *   # Also snapshot 0 for items whose product has no purchase price yet
 *   npm run orders:backfill-costs -- --zero-missing
 *
 * Target user (optional; defaults to the only user if exactly one exists):
 *   --email <address>   or SEED_USER_EMAIL in .env
 *   --user-id <mongoId> or SEED_USER_ID in .env
 *   --all-users         backfill across every account
 *
 * Notes:
 *   - Reads MONGODB_URI from .env. Designed to run against PRODUCTION, so there
 *     is intentionally no localhost guard — review the --dry-run output first.
 *   - Writes are batched via bulkWrite (--batch-size, default 500).
 */

import { config } from 'dotenv';
import mongoose, { Types } from 'mongoose';

config();

const CANCELLED_STATUS = 'cancelled';
const DEFAULT_BATCH_SIZE = 500;

function fail(msg: string): never {
  console.error(`\n[x] ${msg}\n`);
  process.exit(1);
}

function getArgValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
}

const ARGS = new Set(process.argv.slice(2));
const CLI_USER_EMAIL = getArgValue('--email');
const CLI_USER_ID = getArgValue('--user-id');
const ALL_USERS = ARGS.has('--all-users');
const DRY_RUN = ARGS.has('--dry-run');
const ZERO_MISSING = ARGS.has('--zero-missing');
const BATCH_SIZE = (() => {
  const raw = getArgValue('--batch-size');
  if (raw === undefined) return DEFAULT_BATCH_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) fail(`Invalid --batch-size "${raw}" (expected a positive integer)`);
  return n;
})();

/** Round to 2 decimals (mirrors src/common/utils/money.util.ts). */
function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function ensureConnected(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) fail('Missing MONGODB_URI in .env');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

async function resolveUserId(): Promise<string | null> {
  if (ALL_USERS) return null;

  const users = mongoose.connection.db!.collection('users');
  const email = CLI_USER_EMAIL ?? process.env.SEED_USER_EMAIL;
  const userId = CLI_USER_ID ?? process.env.SEED_USER_ID;

  if (email && userId) {
    fail('Use only one of --email / SEED_USER_EMAIL or --user-id / SEED_USER_ID');
  }

  if (email) {
    const user = await users.findOne({ email: email.toLowerCase().trim() });
    if (!user?._id) fail(`No user found with email "${email}".`);
    return String(user._id);
  }

  if (userId) {
    if (!Types.ObjectId.isValid(userId)) fail(`Invalid user id "${userId}"`);
    const user = await users.findOne({ _id: new Types.ObjectId(userId) });
    if (!user?._id) fail(`No user found with id "${userId}"`);
    return String(user._id);
  }

  const allUsers = await users.find({}, { projection: { _id: 1 } }).toArray();
  if (allUsers.length === 0) fail('No users found.');
  if (allUsers.length > 1) {
    fail(
      'Multiple users found. Pass --email <login-email> (or --user-id), ' +
        'or --all-users to backfill every account.',
    );
  }
  return String(allUsers[0]._id);
}

type OrderItemDoc = {
  productId?: unknown;
  quantity?: number;
  unitPrice?: number;
  costPrice?: number | null;
  lineCost?: number | null;
  [key: string]: unknown;
};

type OrderDoc = {
  _id: unknown;
  subtotal?: number;
  costTotal?: number;
  profitTotal?: number;
  items?: OrderItemDoc[];
};

/** costPrice is considered "already snapshotted" only when it's an actual number. */
function hasCostSnapshot(item: OrderItemDoc): boolean {
  return item.costPrice !== null && item.costPrice !== undefined;
}

function productIdKey(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Types.ObjectId) return value.toHexString();
  const str = String(value);
  return str.length ? str : null;
}

async function main(): Promise<void> {
  await ensureConnected();
  const userId = await resolveUserId();

  const orders = mongoose.connection.db!.collection<OrderDoc>('orders');
  const products = mongoose.connection.db!.collection('products');

  const orderFilter: Record<string, unknown> = { status: { $ne: CANCELLED_STATUS } };
  if (userId) orderFilter.userId = new Types.ObjectId(userId);

  // Preload product costs so we don't hit the DB per line item.
  const productFilter: Record<string, unknown> = {};
  if (userId) productFilter.userId = new Types.ObjectId(userId);
  const productDocs = await products
    .find(productFilter, { projection: { purchasePrice: 1 } })
    .toArray();
  const purchasePriceById = new Map<string, number>();
  for (const doc of productDocs) {
    const price = Number((doc as { purchasePrice?: unknown }).purchasePrice);
    purchasePriceById.set(String(doc._id), Number.isFinite(price) ? price : 0);
  }

  const stats = {
    ordersScanned: 0,
    ordersUpdated: 0,
    itemsBackfilled: 0,
    itemsBackfilledZero: 0,
    itemsSkippedExisting: 0,
    itemsSkippedNoProduct: 0,
    itemsSkippedNoCost: 0,
    estimatedTotalCost: 0,
    estimatedTotalProfit: 0,
  };

  type BulkOp = {
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  };
  let pending: BulkOp[] = [];

  const flush = async () => {
    if (DRY_RUN || pending.length === 0) return;
    await orders.bulkWrite(pending, { ordered: false });
    pending = [];
  };

  const cursor = orders.find(orderFilter);
  while (await cursor.hasNext()) {
    const order = (await cursor.next())!;
    stats.ordersScanned++;

    const items = Array.isArray(order.items) ? order.items : [];
    const subtotal = Number(order.subtotal) || 0;

    let changed = false;
    let costTotal = 0;

    const nextItems = items.map((item) => {
      const quantity = Number(item.quantity) || 0;

      // Already snapshotted (incl. genuine 0 on post-feature orders) — keep as-is.
      if (hasCostSnapshot(item)) {
        stats.itemsSkippedExisting++;
        const existingLineCost =
          item.lineCost != null
            ? Number(item.lineCost)
            : roundMoney(Number(item.costPrice) * quantity);
        costTotal = roundMoney(costTotal + (Number.isFinite(existingLineCost) ? existingLineCost : 0));
        return item;
      }

      const key = productIdKey(item.productId);
      const hasProduct = key != null && purchasePriceById.has(key);

      if (!hasProduct) {
        // Product deleted/unknown — can't determine cost. Leave unset so a
        // future re-run (once the product exists again) can pick it up.
        stats.itemsSkippedNoProduct++;
        return item;
      }

      const purchasePrice = purchasePriceById.get(key!)!;

      if (!(purchasePrice > 0)) {
        // Product cost not entered yet. By default skip (don't fabricate a 0
        // snapshot) so filling product costs + re-running converges. With
        // --zero-missing, snapshot 0 per the handoff pseudocode.
        if (!ZERO_MISSING) {
          stats.itemsSkippedNoCost++;
          return item;
        }
        stats.itemsBackfilledZero++;
      } else {
        stats.itemsBackfilled++;
      }

      const costPrice = roundMoney(purchasePrice > 0 ? purchasePrice : 0);
      const lineCost = roundMoney(costPrice * quantity);
      costTotal = roundMoney(costTotal + lineCost);
      changed = true;

      return { ...item, costPrice, lineCost };
    });

    if (!changed) {
      continue;
    }

    const profitTotal = roundMoney(subtotal - costTotal);
    stats.ordersUpdated++;
    stats.estimatedTotalCost = roundMoney(stats.estimatedTotalCost + costTotal);
    stats.estimatedTotalProfit = roundMoney(stats.estimatedTotalProfit + profitTotal);

    pending.push({
      updateOne: {
        filter: { _id: order._id },
        update: { $set: { items: nextItems, costTotal, profitTotal } },
      },
    });

    if (pending.length >= BATCH_SIZE) {
      await flush();
    }
  }

  await flush();

  const itemsAffected = stats.itemsBackfilled + stats.itemsBackfilledZero;

  console.log(`\nOrder cost backfill summary${DRY_RUN ? ' (dry-run — no writes)' : ''}:`);
  console.log(`  scope                       : ${ALL_USERS ? 'all users' : `user ${userId}`}`);
  console.log(`  orders scanned              : ${stats.ordersScanned}`);
  console.log(`  orders ${DRY_RUN ? 'affected' : 'updated '}             : ${stats.ordersUpdated}`);
  console.log(`  items backfilled            : ${stats.itemsBackfilled}`);
  if (ZERO_MISSING) {
    console.log(`  items backfilled (zero cost): ${stats.itemsBackfilledZero}`);
  }
  console.log(`  items skipped (has cost)    : ${stats.itemsSkippedExisting}`);
  console.log(`  items skipped (no product)  : ${stats.itemsSkippedNoProduct}`);
  console.log(`  items skipped (no cost yet) : ${stats.itemsSkippedNoCost}`);
  console.log(`  estimated total cost        : ${stats.estimatedTotalCost}`);
  console.log(`  estimated total profit      : ${stats.estimatedTotalProfit}`);

  if (DRY_RUN) {
    // Machine-readable line for the optional dry-run contract in the handoff.
    console.log(
      '\n' +
        JSON.stringify({
          ordersAffected: stats.ordersUpdated,
          itemsAffected,
          estimatedTotalCost: stats.estimatedTotalCost,
          estimatedTotalProfit: stats.estimatedTotalProfit,
        }),
    );
    console.log('\nDry run complete. Re-run without --dry-run to apply.\n');
  } else {
    console.log('\nBackfill complete.\n');
  }

  if (stats.itemsSkippedNoCost > 0 && !ZERO_MISSING) {
    console.log(
      `[!] ${stats.itemsSkippedNoCost} line item(s) were skipped because their product has no ` +
        `purchase price yet. Fill product costs (products:import-costs), then re-run this to ` +
        `backfill them. (Or pass --zero-missing to snapshot 0 now.)\n`,
    );
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('\nOrder cost backfill failed.');
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors on the failure path
  }
  process.exit(1);
});
