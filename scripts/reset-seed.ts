/* eslint-disable no-console */
/**
 * reset-seed.ts
 *
 * Clears business data (products, customers, orders, payments, ledger) from
 * the local MongoDB database and re-seeds realistic Pakistani pharmacy data
 * using the same NestJS services as the API — preserving stock, ledger, and
 * invoice invariants.
 *
 * Usage:
 *   npm run db:reset-seed              # reset + seed (default)
 *   npm run db:reset-seed -- --reset-only
 *   npm run db:reset-seed -- --seed-only
 *   npm run db:reset-seed -- --force     # bypass localhost URI check
 *
 * Safety:
 *   - Refuses NODE_ENV=production
 *   - Requires MONGODB_URI to target localhost / 127.0.0.1 (unless --force)
 *   - Does NOT delete users (auth accounts are preserved)
 */

import 'reflect-metadata';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProductService } from '../src/modules/product/product.service';
import { CustomerService } from '../src/modules/customer/customer.service';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { roundMoney } from '../src/common/utils/money.util';
import {
  SEED_CUSTOMERS,
  SEED_ORDERS,
  SEED_PRODUCTS,
  SEED_STANDALONE_PAYMENTS,
} from './seed-data';

config();

const COLLECTIONS_TO_CLEAR = [
  'ledgerentries',
  'payments',
  'customerbalanceadjustments',
  'stockmovements',
  'orders',
  'counters',
  'customers',
  'products',
] as const;

const args = new Set(process.argv.slice(2));
const RESET_ONLY = args.has('--reset-only');
const SEED_ONLY = args.has('--seed-only');
const FORCE = args.has('--force');

function fail(msg: string): never {
  console.error(`\n[x] ${msg}\n`);
  process.exit(1);
}

function assertSafeToRun(): void {
  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    fail('Missing MONGODB_URI in .env');
  }

  if (!FORCE) {
    const localPattern = /localhost|127\.0\.0\.1/i;
    if (!localPattern.test(uri)) {
      fail(
        'MONGODB_URI does not look like a local database. ' +
          'Use --force only if you are absolutely sure.',
      );
    }
  }
}

function parseDbName(uri: string): string {
  const normalized = uri.replace(/^mongodb(\+srv)?:\/\//, 'https://');
  const parsed = new URL(normalized);
  return parsed.pathname.replace(/^\//, '') || 'test';
}

async function resetCollections(): Promise<void> {
  const uri = process.env.MONGODB_URI!;
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const dbName = parseDbName(uri);

  console.log(`\n[~] Resetting business data in "${dbName}"...\n`);

  for (const name of COLLECTIONS_TO_CLEAR) {
    const result = await db.collection(name).deleteMany({});
    console.log(`    cleared ${name}: ${result.deletedCount} document(s)`);
  }

  if (!SEED_ONLY) {
    await mongoose.disconnect();
  }

  console.log('\n[✓] Reset complete (users preserved)\n');
}

async function resolveSeedUserId(): Promise<string> {
  const uri = process.env.MONGODB_URI!;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }

  const users = mongoose.connection.db!.collection('users');
  const existing = await users.find({}).sort({ createdAt: 1 }).limit(1).next();

  if (existing?._id) {
    console.log(`[~] Seeding as user: ${existing.email} (${existing._id})\n`);
    return String(existing._id);
  }

  fail('No users found. Register an account first, then run db:reset-seed.');
}

async function seedDatabase(): Promise<void> {
  console.log('[~] Bootstrapping NestJS application context...\n');

  const seedUserId = await resolveSeedUserId();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const productService = app.get(ProductService);
  const customerService = app.get(CustomerService);
  const orderService = app.get(OrderService);
  const paymentService = app.get(PaymentService);
  const ledgerService = app.get(LedgerService);

  const productIds = new Map<string, string>();
  const customerIds = new Map<string, string>();

  console.log('[~] Creating products...');
  for (const product of SEED_PRODUCTS) {
    const { key, ...dto } = product;
    const created = await productService.create(seedUserId, { ...dto });
    productIds.set(key, String(created._id));
    console.log(`    + ${product.name} (${product.quantityInStock} in stock)`);
  }

  console.log('\n[~] Creating customers...');
  for (const customer of SEED_CUSTOMERS) {
    const { key, ...dto } = customer;
    const created = await customerService.create(seedUserId, { ...dto });
    customerIds.set(key, String(created._id));
    const label = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
    console.log(`    + ${label} — ${customer.city}`);
  }

  console.log('\n[~] Creating orders...');
  const orderRecords = new Map<string, { id: string; grandTotal: number; customerKey: string }>();

  for (const spec of SEED_ORDERS) {
    const customerId = customerIds.get(spec.customerKey);
    if (!customerId) {
      fail(`Unknown customer key: ${spec.customerKey}`);
    }

    const items = spec.items.map((item) => {
      const productId = productIds.get(item.productKey);
      if (!productId) {
        fail(`Unknown product key: ${item.productKey}`);
      }
      return {
        productId,
        quantity: item.quantity,
        discountPercentage: item.discountPercentage,
      };
    });

    const order = await orderService.create(seedUserId, {
      customerId,
      items,
      note: spec.note,
    });

    const orderId = String(order._id);
    const grandTotal = roundMoney(order.grandTotal);
    orderRecords.set(spec.key, { id: orderId, grandTotal, customerKey: spec.customerKey });

    let status = 'pending';
    if (spec.cancel) {
      await orderService.cancelOrder(seedUserId, orderId);
      status = 'cancelled';
    } else if (spec.confirm) {
      await orderService.confirmOrder(seedUserId, orderId);
      status = 'completed';

      if (spec.payments?.length) {
        for (const payment of spec.payments) {
          const amount =
            payment.fractionOfTotal != null
              ? roundMoney(grandTotal * payment.fractionOfTotal)
              : roundMoney(payment.amount);

          if (amount <= 0) continue;

          await paymentService.recordPayment(seedUserId, {
            customerId,
            orderId,
            amount,
            paymentMethod: payment.method,
            note: payment.note,
          });
          console.log(`      ↳ payment Rs ${amount} via ${payment.method}`);
        }
      }

      if (spec.returnAfterConfirm) {
        await orderService.returnOrder(seedUserId, orderId);
        status = 'returned';
      }
    }

    console.log(`    + ${spec.key} → ${order.invoiceNumber} (${status}, Rs ${grandTotal})`);
  }

  console.log('\n[~] Recording standalone payments...');
  for (const payment of SEED_STANDALONE_PAYMENTS) {
    const customerId = customerIds.get(payment.customerKey);
    if (!customerId) {
      fail(`Unknown customer key: ${payment.customerKey}`);
    }

    await paymentService.recordPayment(seedUserId, {
      customerId,
      amount: payment.amount,
      paymentMethod: payment.method,
      note: payment.note,
    });
    console.log(`    + ${payment.customerKey}: Rs ${payment.amount} (${payment.method})`);
  }

  console.log('\n[~] Verifying customer balances...\n');
  for (const customer of SEED_CUSTOMERS) {
    const customerId = customerIds.get(customer.key)!;
    const balance = await ledgerService.getCustomerBalance(seedUserId, customerId);
    const label = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
    console.log(
      `    ${label}: Rs ${balance.absoluteAmount} (${balance.direction}) — net ${balance.netBalance}`,
    );
  }

  await app.close();
  console.log('\n[✓] Seed complete\n');
}

async function main(): Promise<void> {
  assertSafeToRun();

  if (RESET_ONLY && SEED_ONLY) {
    fail('Use only one of --reset-only or --seed-only');
  }

  const doReset = !SEED_ONLY;
  const doSeed = !RESET_ONLY;

  if (doReset) {
    await resetCollections();
  }

  if (doSeed) {
    if (SEED_ONLY) {
      assertSafeToRun();
    }
    await seedDatabase();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[x] reset-seed failed:\n', err);
  process.exit(1);
});
