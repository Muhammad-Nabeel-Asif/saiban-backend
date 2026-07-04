/* eslint-disable no-console */
/**
 * backfill-purchase-price.ts
 *
 * Safely backfill product purchase (cost) prices in bulk via a CSV round-trip.
 * Profit/margin is only meaningful with REAL supplier costs, so this tool never
 * guesses a cost — it just makes it painless for the client to provide them.
 *
 * Workflow:
 *   1. Export current products to a CSV (one row per product, blank/zero cost
 *      highlighted) for the client to fill in real costs in Excel/Sheets.
 *   2. Import the filled CSV back. Safe by default: dry-run preview, never
 *      overwrites an existing non-zero cost (unless --overwrite), idempotent.
 *
 * Usage:
 *   # Export everything (or just the rows still missing a cost)
 *   npm run products:export-costs -- --out costs.csv
 *   npm run products:export-costs -- --out missing.csv --missing-only
 *   npm run products:export-costs -- --email owner@store.pk --out costs.csv
 *
 *   # Preview an import (no writes), then apply it
 *   npm run products:import-costs -- --in costs.csv --dry-run
 *   npm run products:import-costs -- --in costs.csv
 *   npm run products:import-costs -- --in costs.csv --overwrite   # allow clobber
 *
 * Target user (optional; defaults to the only user if exactly one exists):
 *   --email <address>   or SEED_USER_EMAIL in .env
 *   --user-id <mongoId> or SEED_USER_ID in .env
 *   --all-users         export across every account (adds a userId column)
 *
 * Notes:
 *   - Reads MONGODB_URI from .env. This is designed to run against PRODUCTION,
 *     so there is intentionally no localhost guard — review the dry-run output.
 *   - Rows are matched by product `_id` (stable). Leave `purchasePrice` blank to
 *     skip a row. Values must be numbers >= 0 (rounded to 2 decimals).
 */

import { config } from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { writeFileSync, readFileSync, existsSync } from 'fs';

config();

type Mode = 'export' | 'import';

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
const MODE = process.argv[2] as Mode | undefined;
const CLI_USER_EMAIL = getArgValue('--email');
const CLI_USER_ID = getArgValue('--user-id');
const ALL_USERS = ARGS.has('--all-users');
const DRY_RUN = ARGS.has('--dry-run');
const OVERWRITE = ARGS.has('--overwrite');
const MISSING_ONLY = ARGS.has('--missing-only');
const OUT_PATH = getArgValue('--out');
const IN_PATH = getArgValue('--in');

/** Round to 2 decimals (mirrors src/common/utils/money.util.ts). */
function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Minimal, dependency-free CSV (RFC-4180-ish: quotes fields containing
// comma/quote/newline, escapes embedded quotes by doubling).
// ---------------------------------------------------------------------------
function toCsv(rows: string[][]): string {
  const encodeCell = (cell: string): string => {
    const needsQuoting = /[",\r\n]/.test(cell);
    const escaped = cell.replace(/"/g, '""');
    return needsQuoting ? `"${escaped}"` : escaped;
  };
  return rows.map((row) => row.map(encodeCell).join(',')).join('\r\n') + '\r\n';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // swallow; \n handles the row break (handles CRLF and lone CR before \n)
    } else {
      field += char;
    }
  }

  // Flush trailing field/row if file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
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
        'or --all-users to export every account.',
    );
  }
  return String(allUsers[0]._id);
}

const CSV_HEADER_BASE = [
  '_id',
  'name',
  'formulation',
  'packType',
  'size',
  'unitPrice',
  'purchasePrice',
];

async function runExport(): Promise<void> {
  if (!OUT_PATH) fail('Export requires --out <file.csv>');

  await ensureConnected();
  const userId = await resolveUserId();
  const products = mongoose.connection.db!.collection('products');

  const filter: Record<string, unknown> = {};
  if (userId) filter.userId = new Types.ObjectId(userId);
  if (MISSING_ONLY) {
    filter.$or = [
      { purchasePrice: { $exists: false } },
      { purchasePrice: null },
      { purchasePrice: { $lte: 0 } },
    ];
  }

  const docs = await products.find(filter).sort({ name: 1 }).toArray();

  const header = ALL_USERS ? ['userId', ...CSV_HEADER_BASE] : CSV_HEADER_BASE;
  const rows: string[][] = [header];

  let missing = 0;
  for (const doc of docs) {
    const purchasePrice = Number(doc.purchasePrice);
    const hasCost = Number.isFinite(purchasePrice) && purchasePrice > 0;
    if (!hasCost) missing++;

    const base = [
      String(doc._id),
      String(doc.name ?? ''),
      String(doc.formulation ?? ''),
      String(doc.packType ?? ''),
      String(doc.size ?? ''),
      String(doc.unitPrice ?? ''),
      hasCost ? String(roundMoney(purchasePrice)) : '',
    ];
    rows.push(ALL_USERS ? [String(doc.userId ?? ''), ...base] : base);
  }

  writeFileSync(OUT_PATH, toCsv(rows), 'utf8');

  console.log(`\n[+] Exported ${docs.length} product(s) to ${OUT_PATH}`);
  console.log(`    ${missing} product(s) still need a purchase price.`);
  console.log(`    Fill in the "purchasePrice" column, then run products:import-costs.\n`);

  await mongoose.disconnect();
}

async function runImport(): Promise<void> {
  if (!IN_PATH) fail('Import requires --in <file.csv>');
  if (!existsSync(IN_PATH)) fail(`File not found: ${IN_PATH}`);

  await ensureConnected();
  const products = mongoose.connection.db!.collection('products');

  const text = readFileSync(IN_PATH, 'utf8');
  const table = parseCsv(text);
  if (table.length < 2) fail('CSV has no data rows.');

  const header = table[0].map((h) => h.trim());
  const idIdx = header.indexOf('_id');
  const costIdx = header.indexOf('purchasePrice');
  if (idIdx === -1) fail('CSV is missing required "_id" column.');
  if (costIdx === -1) fail('CSV is missing required "purchasePrice" column.');

  const stats = {
    rows: 0,
    updated: 0,
    skippedBlank: 0,
    skippedExisting: 0,
    skippedUnchanged: 0,
    notFound: 0,
    invalid: 0,
  };
  const ops: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }> = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    stats.rows++;

    const idRaw = (cells[idIdx] ?? '').trim();
    const costRaw = (cells[costIdx] ?? '').trim();

    if (!idRaw || !Types.ObjectId.isValid(idRaw)) {
      console.warn(`  ! Row ${i + 1}: invalid/missing _id "${idRaw}" — skipped`);
      stats.invalid++;
      continue;
    }
    if (costRaw === '') {
      stats.skippedBlank++;
      continue;
    }

    const cost = Number(costRaw);
    if (!Number.isFinite(cost) || cost < 0) {
      console.warn(`  ! Row ${i + 1} (${idRaw}): invalid purchasePrice "${costRaw}" — skipped`);
      stats.invalid++;
      continue;
    }

    const rounded = roundMoney(cost);
    const existing = await products.findOne(
      { _id: new Types.ObjectId(idRaw) },
      { projection: { purchasePrice: 1, unitPrice: 1, name: 1 } },
    );

    if (!existing) {
      console.warn(`  ! Row ${i + 1}: product ${idRaw} not found — skipped`);
      stats.notFound++;
      continue;
    }

    const current = Number(existing.purchasePrice);
    const hasCurrent = Number.isFinite(current) && current > 0;

    if (hasCurrent && !OVERWRITE) {
      if (current !== rounded) {
        console.warn(
          `  ~ Row ${i + 1} (${existing.name}): keeps existing cost ${current} ` +
            `(CSV had ${rounded}; pass --overwrite to change) — skipped`,
        );
      }
      stats.skippedExisting++;
      continue;
    }

    if (Number.isFinite(current) && current === rounded) {
      stats.skippedUnchanged++;
      continue;
    }

    if (rounded > Number(existing.unitPrice)) {
      console.warn(
        `  ⚠ Row ${i + 1} (${existing.name}): cost ${rounded} exceeds sale price ` +
          `${existing.unitPrice} (negative margin) — applying anyway`,
      );
    }

    ops.push({
      updateOne: {
        filter: { _id: new Types.ObjectId(idRaw) },
        update: { $set: { purchasePrice: rounded } },
      },
    });
    stats.updated++;
  }

  if (!DRY_RUN && ops.length) {
    await products.bulkWrite(ops, { ordered: false });
  }

  console.log(`\nImport summary${DRY_RUN ? ' (dry-run — no writes)' : ''}:`);
  console.log(`  data rows            : ${stats.rows}`);
  console.log(`  ${DRY_RUN ? 'would update' : 'updated'}          : ${stats.updated}`);
  console.log(`  skipped (blank)      : ${stats.skippedBlank}`);
  console.log(`  skipped (already set): ${stats.skippedExisting}`);
  console.log(`  skipped (unchanged)  : ${stats.skippedUnchanged}`);
  console.log(`  not found            : ${stats.notFound}`);
  console.log(`  invalid              : ${stats.invalid}`);
  console.log(
    DRY_RUN ? '\nDry run complete. Re-run without --dry-run to apply.\n' : '\nImport complete.\n',
  );

  await mongoose.disconnect();
}

async function main(): Promise<void> {
  if (MODE !== 'export' && MODE !== 'import') {
    fail('First argument must be "export" or "import". See header for usage.');
  }
  if (MODE === 'export') {
    await runExport();
  } else {
    await runImport();
  }
}

main().catch(async (error) => {
  console.error('\nBackfill failed.');
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors on the failure path
  }
  process.exit(1);
});
