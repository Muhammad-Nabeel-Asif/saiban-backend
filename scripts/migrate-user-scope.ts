/* eslint-disable no-console */
/**
 * migrate-user-scope.ts
 *
 * Backfills userId on existing products, customers, and orders so legacy
 * single-tenant data is assigned to one store owner account.
 *
 * Usage:
 *   npm run db:migrate-user-scope
 *   npm run db:migrate-user-scope -- --email owner@example.com
 *   npm run db:migrate-user-scope -- --dry-run
 *
 * Safety:
 *   - Refuses NODE_ENV=production unless --force is passed
 *   - Defaults to the oldest user in the users collection
 */

import 'reflect-metadata';
import { config } from 'dotenv';
import mongoose from 'mongoose';

config();

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY_RUN = args.has('--dry-run');
const emailArgIndex = process.argv.indexOf('--email');
const OWNER_EMAIL = emailArgIndex >= 0 ? process.argv[emailArgIndex + 1] : undefined;

function fail(msg: string): never {
  console.error(`\n[x] ${msg}\n`);
  process.exit(1);
}

function assertSafeToRun(): void {
  if (process.env.NODE_ENV === 'production' && !FORCE) {
    fail('Refusing to run with NODE_ENV=production (use --force if intentional)');
  }

  if (!process.env.MONGODB_URI) {
    fail('Missing MONGODB_URI in .env');
  }
}

async function dropLegacyIndexes(db: mongoose.mongo.Db): Promise<void> {
  const products = db.collection('products');
  const orders = db.collection('orders');

  for (const collection of [products, orders]) {
    const indexes = await collection.indexes();
    for (const index of indexes) {
      const keys = Object.keys(index.key ?? {});
      if (keys.length === 1 && keys[0] === 'name' && index.unique) {
        console.log(`    dropping legacy products.name unique index`);
        if (!DRY_RUN) await collection.dropIndex(index.name!);
      }
      if (keys.length === 1 && keys[0] === 'invoiceNumber' && index.unique) {
        console.log(`    dropping legacy orders.invoiceNumber unique index`);
        if (!DRY_RUN) await collection.dropIndex(index.name!);
      }
    }
  }
}

async function main(): Promise<void> {
  assertSafeToRun();

  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db!;

  const users = db.collection('users');
  const owner = OWNER_EMAIL
    ? await users.findOne({ email: OWNER_EMAIL })
    : await users.find({}).sort({ createdAt: 1 }).limit(1).next();

  if (!owner?._id) {
    fail(
      OWNER_EMAIL
        ? `No user found with email ${OWNER_EMAIL}`
        : 'No users found. Register an account first, then rerun migration.',
    );
  }

  const ownerId = owner._id;
  console.log(`\n[~] Assigning legacy data to user ${owner.email} (${ownerId})`);
  if (DRY_RUN) {
    console.log('    (dry run — no writes)\n');
  }

  const products = db.collection('products');
  const customers = db.collection('customers');
  const orders = db.collection('orders');

  const [productsMissing, customersMissing, ordersMissing] = await Promise.all([
    products.countDocuments({ $or: [{ userId: { $exists: false } }, { userId: null }] }),
    customers.countDocuments({ $or: [{ userId: { $exists: false } }, { userId: null }] }),
    orders.countDocuments({ $or: [{ userId: { $exists: false } }, { userId: null }] }),
  ]);

  console.log(`    products needing userId: ${productsMissing}`);
  console.log(`    customers needing userId: ${customersMissing}`);
  console.log(`    orders needing userId: ${ordersMissing}`);

  if (!DRY_RUN) {
    if (productsMissing > 0) {
      await products.updateMany(
        { $or: [{ userId: { $exists: false } }, { userId: null }] },
        { $set: { userId: ownerId } },
      );
    }

    if (customersMissing > 0) {
      await customers.updateMany(
        { $or: [{ userId: { $exists: false } }, { userId: null }] },
        { $set: { userId: ownerId } },
      );
    }

    if (ordersMissing > 0) {
      const cursor = orders.find({ $or: [{ userId: { $exists: false } }, { userId: null }] });
      for await (const order of cursor) {
        const customer = await customers.findOne({ _id: order.customerId });
        const userId = customer?.userId ?? ownerId;
        await orders.updateOne({ _id: order._id }, { $set: { userId } });
      }
    }

    console.log('\n[~] Dropping legacy unique indexes (if present)...');
    await dropLegacyIndexes(db);

    console.log('\n[~] Ensuring compound indexes...');
    await products.createIndex({ userId: 1, name: 1 }, { unique: true });
    await orders.createIndex({ userId: 1, invoiceNumber: 1 }, { unique: true, sparse: true });
  }

  await mongoose.disconnect();
  console.log('\n[✓] User-scope migration complete\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[x] migrate-user-scope failed:\n', err);
  process.exit(1);
});
