/* eslint-disable no-console */
require('dotenv').config();

const mongoose = require('mongoose');

const SOURCE_TYPE_PAYMENT = 'payment';
const SOURCE_TYPE_ADJUSTMENT = 'adjustment';
const DEFAULT_BATCH_SIZE = 500;

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const batchSizeArg = argv.find((arg) => arg.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? Number(batchSizeArg.split('=')[1]) : DEFAULT_BATCH_SIZE;

  return {
    dryRun: args.has('--dry-run'),
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : DEFAULT_BATCH_SIZE,
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function backfillSourceType({
  ledgerCollection,
  sourceCollection,
  sourceType,
  batchSize,
  dryRun,
}) {
  const filter = {
    sourceType,
    $or: [{ note: { $exists: false } }, { note: null }, { note: '' }],
  };

  const cursor = ledgerCollection.find(filter, {
    projection: { _id: 1, sourceId: 1, note: 1 },
  });

  let scanned = 0;
  let updated = 0;
  let skippedNoSourceNote = 0;
  let queued = [];

  async function flushQueue() {
    if (!queued.length) return;

    const sourceIds = [
      ...new Set(queued.map((entry) => String(entry.sourceId)).filter((id) => id !== 'undefined')),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const sources = await sourceCollection
      .find({ _id: { $in: sourceIds } }, { projection: { _id: 1, note: 1 } })
      .toArray();

    const noteBySourceId = new Map(
      sources
        .filter((source) => isNonEmptyString(source.note))
        .map((source) => [String(source._id), source.note.trim()]),
    );

    const ops = [];
    for (const entry of queued) {
      const note = noteBySourceId.get(String(entry.sourceId));
      if (!isNonEmptyString(note)) {
        skippedNoSourceNote += 1;
        continue;
      }

      ops.push({
        updateOne: {
          filter: { _id: entry._id },
          update: { $set: { note } },
        },
      });
    }

    if (!dryRun && ops.length) {
      const result = await ledgerCollection.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount;
    } else {
      updated += ops.length;
    }

    queued = [];
  }

  for await (const ledgerEntry of cursor) {
    scanned += 1;
    queued.push(ledgerEntry);

    if (queued.length >= batchSize) {
      await flushQueue();
    }
  }

  await flushQueue();

  return { sourceType, scanned, updated, skippedNoSourceNote };
}

async function run() {
  const { dryRun, batchSize } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('Missing MONGODB_URI in environment');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error('Database connection not available');
  }

  const ledgerCollection = db.collection('ledgerentries');
  const paymentCollection = db.collection('payments');
  const adjustmentCollection = db.collection('customerbalanceadjustments');

  console.log(`\nStarting ledger note backfill${dryRun ? ' (dry-run)' : ''}...`);
  console.log(`Batch size: ${batchSize}`);

  const paymentResult = await backfillSourceType({
    ledgerCollection,
    sourceCollection: paymentCollection,
    sourceType: SOURCE_TYPE_PAYMENT,
    batchSize,
    dryRun,
  });

  const adjustmentResult = await backfillSourceType({
    ledgerCollection,
    sourceCollection: adjustmentCollection,
    sourceType: SOURCE_TYPE_ADJUSTMENT,
    batchSize,
    dryRun,
  });

  const totalScanned = paymentResult.scanned + adjustmentResult.scanned;
  const totalUpdated = paymentResult.updated + adjustmentResult.updated;
  const totalSkipped = paymentResult.skippedNoSourceNote + adjustmentResult.skippedNoSourceNote;

  console.log('\nBackfill summary:');
  console.log(
    `- payment: scanned=${paymentResult.scanned}, updated=${paymentResult.updated}, skipped=${paymentResult.skippedNoSourceNote}`,
  );
  console.log(
    `- adjustment: scanned=${adjustmentResult.scanned}, updated=${adjustmentResult.updated}, skipped=${adjustmentResult.skippedNoSourceNote}`,
  );
  console.log(`- total: scanned=${totalScanned}, updated=${totalUpdated}, skipped=${totalSkipped}`);
  console.log(`\n${dryRun ? 'Dry run complete. No data was modified.' : 'Backfill completed successfully.'}\n`);

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('\nLedger note backfill failed.');
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors on failure path
  }
  process.exit(1);
});
