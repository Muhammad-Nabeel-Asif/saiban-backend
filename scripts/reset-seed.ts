/* eslint-disable no-console */
/**
 * reset-seed.ts
 *
 * Clears one store owner's business data (products, customers, orders,
 * payments, ledger, stock movements, invoice counters) and re-seeds realistic
 * Pakistani pharmacy data using the same NestJS services as the API —
 * preserving stock, ledger, and invoice invariants.
 *
 * Usage:
 *   npm run db:reset-seed -- --email you@example.com
 *   npm run db:reset-seed -- --user-id 507f1f77bcf86cd799439011
 *   npm run db:reset-seed -- --email you@example.com --reset-only
 *   npm run db:reset-seed -- --email you@example.com --seed-only
 *   npm run db:reset-seed -- --force     # bypass localhost URI check
 *
 * Target user (required when multiple accounts exist):
 *   --email <address>   or SEED_USER_EMAIL in .env
 *   --user-id <mongoId> or SEED_USER_ID in .env
 *   If exactly one user exists, that account is used automatically.
 *
 * Safety:
 *   - Refuses NODE_ENV=production
 *   - Requires MONGODB_URI to target localhost / 127.0.0.1 (unless --force)
 *   - Does NOT delete auth accounts; only the chosen user's business data
 *   - Other users' products, customers, and orders are left untouched
 */

import 'reflect-metadata';
import { config } from 'dotenv';
import mongoose, { Types } from 'mongoose';
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

const args = new Set(process.argv.slice(2));
const RESET_ONLY = args.has('--reset-only');
const SEED_ONLY = args.has('--seed-only');
const FORCE = args.has('--force');

type TargetUser = { id: string; email: string };

function getArgValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
}

const CLI_USER_EMAIL = getArgValue('--email');
const CLI_USER_ID = getArgValue('--user-id');

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

async function ensureConnected(): Promise<void> {
  const uri = process.env.MONGODB_URI!;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

async function resolveTargetUser(): Promise<TargetUser> {
  await ensureConnected();

  const users = mongoose.connection.db!.collection('users');
  const email = CLI_USER_EMAIL ?? process.env.SEED_USER_EMAIL;
  const userId = CLI_USER_ID ?? process.env.SEED_USER_ID;

  if (email && userId) {
    fail('Use only one of --email / SEED_USER_EMAIL or --user-id / SEED_USER_ID');
  }

  if (email) {
    const user = await users.findOne({ email: email.toLowerCase().trim() });
    if (!user?._id) {
      fail(`No user found with email "${email}". Register or log in first.`);
    }
    return { id: String(user._id), email: String(user.email) };
  }

  if (userId) {
    if (!Types.ObjectId.isValid(userId)) {
      fail(`Invalid user id "${userId}"`);
    }
    const user = await users.findOne({ _id: new Types.ObjectId(userId) });
    if (!user?._id) {
      fail(`No user found with id "${userId}"`);
    }
    return { id: String(user._id), email: String(user.email) };
  }

  const allUsers = await users.find({}).sort({ createdAt: 1 }).toArray();
  if (allUsers.length === 0) {
    fail('No users found. Register an account first, then run db:reset-seed.');
  }
  if (allUsers.length > 1) {
    fail(
      'Multiple users found. Pass --email <your-login-email> (or set SEED_USER_EMAIL) ' +
        'so data is reset and seeded for the account you use in the app.',
    );
  }

  const user = allUsers[0];
  return { id: String(user._id), email: String(user.email) };
}

async function resetUserData(userId: string, userEmail: string): Promise<void> {
  await ensureConnected();

  const db = mongoose.connection.db!;
  const dbName = parseDbName(process.env.MONGODB_URI!);
  const userObjectId = new Types.ObjectId(userId);

  console.log(
    `\n[~] Resetting business data for ${userEmail} in "${dbName}" (other users untouched)...\n`,
  );

  const customers = db.collection('customers');
  const products = db.collection('products');

  const customerIds = (
    await customers.find({ userId: userObjectId }, { projection: { _id: 1 } }).toArray()
  ).map((doc) => doc._id);
  const productIds = (
    await products.find({ userId: userObjectId }, { projection: { _id: 1 } }).toArray()
  ).map((doc) => doc._id);

  const deletions: Array<{ label: string; result: { deletedCount?: number } }> = [];

  if (customerIds.length > 0) {
    deletions.push({
      label: 'ledgerentries',
      result: await db.collection('ledgerentries').deleteMany({ customerId: { $in: customerIds } }),
    });
    deletions.push({
      label: 'payments',
      result: await db.collection('payments').deleteMany({ customerId: { $in: customerIds } }),
    });
    deletions.push({
      label: 'customerbalanceadjustments',
      result: await db
        .collection('customerbalanceadjustments')
        .deleteMany({ customerId: { $in: customerIds } }),
    });
  }

  if (productIds.length > 0) {
    deletions.push({
      label: 'stockmovements',
      result: await db.collection('stockmovements').deleteMany({ productId: { $in: productIds } }),
    });
  }

  deletions.push({
    label: 'orders',
    result: await db.collection('orders').deleteMany({ userId: userObjectId }),
  });
  deletions.push({
    label: 'customers',
    result: await customers.deleteMany({ userId: userObjectId }),
  });
  deletions.push({
    label: 'products',
    result: await products.deleteMany({ userId: userObjectId }),
  });
  deletions.push({
    label: 'counters',
    result: await db.collection('counters').deleteMany({
      key: { $regex: `^invoice-${userId}-` },
    }),
  });

  for (const { label, result } of deletions) {
    console.log(`    cleared ${label}: ${result.deletedCount ?? 0} document(s)`);
  }

  if (!SEED_ONLY) {
    await mongoose.disconnect();
  }

  console.log('\n[✓] Reset complete (auth accounts preserved)\n');
}

async function seedDatabase(seedUserId: string, userEmail: string): Promise<void> {
  console.log(`[~] Bootstrapping NestJS application context for ${userEmail}...\n`);

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

  const targetUser = await resolveTargetUser();
  console.log(`[~] Target account: ${targetUser.email} (${targetUser.id})\n`);

  const doReset = !SEED_ONLY;
  const doSeed = !RESET_ONLY;

  if (doReset) {
    await resetUserData(targetUser.id, targetUser.email);
  }

  if (doSeed) {
    if (SEED_ONLY) {
      assertSafeToRun();
      await ensureConnected();
    }
    await seedDatabase(targetUser.id, targetUser.email);
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n[x] reset-seed failed:\n', err);
  process.exit(1);
});
