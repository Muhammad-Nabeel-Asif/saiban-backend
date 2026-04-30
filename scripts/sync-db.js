/* eslint-disable no-console */
/**
 * sync-db.js
 *
 * Copies (clones) the PRODUCTION MongoDB database into the STAGING database
 * using `mongodump` + `mongorestore` with namespace remapping.
 *
 * Safety model (read before editing):
 *   1. Refuses to run if NODE_ENV=production.
 *   2. Refuses to run if PROD and STAGING URIs / DB names are identical.
 *   3. Requires the staging DB name to look like a non-prod env
 *      (must contain one of: staging, stage, dev, test, qa).
 *      Override with --i-know-what-im-doing if you really need to.
 *   4. Requires interactive "CONFIRM <staging-db-name>" prompt.
 *   5. Uses spawnSync with an args array (no shell), so credentials
 *      are not interpolated into a shell command line.
 *   6. Dumps to a single gzipped archive in os.tmpdir() and deletes
 *      it in a `finally` block, even on failure.
 *   7. Optional sanitization hook runs against the staging DB after
 *      restore to scrub PII / secrets. EDIT `sanitizeStaging()` to
 *      match your schema before relying on this in any shared env.
 *
 * Usage:
 *   npm run sync:db
 *   npm run sync:db -- --i-know-what-im-doing   # bypass the name heuristic
 *   npm run sync:db -- --skip-sanitize          # skip the PII scrub step
 */

require('dotenv').config();

const { spawnSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROD_URI = process.env.MONGODB_URI_PROD;
const STAGING_URI = process.env.MONGODB_URI_STAGING;

const args = new Set(process.argv.slice(2));
const BYPASS_NAME_CHECK = args.has('--i-know-what-im-doing');
const SKIP_SANITIZE = args.has('--skip-sanitize');

function fail(msg) {
  console.error(`\n[x] ${msg}\n`);
  process.exit(1);
}

if (!PROD_URI || !STAGING_URI) {
  fail('Missing MONGODB_URI_PROD or MONGODB_URI_STAGING in .env');
}

if (process.env.NODE_ENV === 'production') {
  fail('Refusing to run with NODE_ENV=production');
}

function parseUri(uri) {
  // mongodb:// and mongodb+srv:// are not parseable by Node's WHATWG URL,
  // so swap the scheme to https:// just for parsing host + path.
  const normalized = uri.replace(/^mongodb(\+srv)?:\/\//, 'https://');
  const parsed = new URL(normalized);
  const dbName = parsed.pathname.replace(/^\//, '') || null;
  return { host: parsed.host, dbName };
}

const prod = parseUri(PROD_URI);
const staging = parseUri(STAGING_URI);

if (!prod.dbName) fail('PROD URI has no database name in its path');
if (!staging.dbName) fail('STAGING URI has no database name in its path');

if (PROD_URI === STAGING_URI) {
  fail('PROD and STAGING URIs are identical. Refusing to run.');
}

if (prod.dbName === staging.dbName && prod.host === staging.host) {
  fail(
    `PROD and STAGING point to the same database (${prod.host}/${prod.dbName}). ` +
      'Refusing to run.',
  );
}

const STAGING_NAME_REGEX = /(staging|stage|dev|test|qa)/i;
if (!STAGING_NAME_REGEX.test(staging.dbName) && !BYPASS_NAME_CHECK) {
  fail(
    `Staging DB name "${staging.dbName}" does not look like a non-prod env. ` +
      'Expected one of: staging, stage, dev, test, qa. ' +
      'Pass --i-know-what-im-doing to override.',
  );
}

function ensureCommand(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  if (r.error || r.status !== 0) {
    fail(
      `Required command "${cmd}" not found on PATH. ` +
        'Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools',
    );
  }
}
ensureCommand('mongodump');
ensureCommand('mongorestore');

const ARCHIVE = path.join(os.tmpdir(), `mongo-sync-${Date.now()}.archive.gz`);

function maskUri(uri) {
  return uri.replace(/\/\/[^@]+@/, '//***:***@');
}

console.log('\n[!] WARNING: This will OVERWRITE your staging database.\n');
console.log(`Source (PROD):    ${prod.host}/${prod.dbName}`);
console.log(`Target (STAGING): ${staging.host}/${staging.dbName}`);
console.log(`Archive file:     ${ARCHIVE}`);
console.log(`PROD URI:         ${maskUri(PROD_URI)}`);
console.log(`STAGING URI:      ${maskUri(STAGING_URI)}`);
console.log(`Sanitize step:    ${SKIP_SANITIZE ? 'SKIPPED' : 'enabled'}\n`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const expected = `CONFIRM ${staging.dbName}`;
rl.question(`Type "${expected}" to continue: `, async (answer) => {
  rl.close();

  if (answer.trim() !== expected) {
    console.log('[x] Operation cancelled.');
    process.exit(0);
  }

  try {
    console.log('\n[1/3] Dumping production database...');
    const dump = spawnSync('mongodump', [`--uri=${PROD_URI}`, `--archive=${ARCHIVE}`, '--gzip'], {
      stdio: 'inherit',
    });
    if (dump.status !== 0) {
      throw new Error(`mongodump exited with code ${dump.status}`);
    }

    console.log('\n[2/3] Restoring into staging database...');
    const restore = spawnSync(
      'mongorestore',
      [
        `--uri=${STAGING_URI}`,
        `--archive=${ARCHIVE}`,
        '--gzip',
        `--nsInclude=${prod.dbName}.*`,
        `--nsFrom=${prod.dbName}.*`,
        `--nsTo=${staging.dbName}.*`,
        '--drop',
        // NOTE: do NOT add --preserveUUID here. It requires the
        // `applyOps` command on the admin DB, which MongoDB Atlas
        // blocks for regular users, causing restore to fail.
      ],
      { stdio: 'inherit' },
    );
    if (restore.status !== 0) {
      throw new Error(`mongorestore exited with code ${restore.status}`);
    }

    if (!SKIP_SANITIZE) {
      console.log('\n[3/3] Sanitizing PII / secrets in staging...');
      await sanitizeStaging(STAGING_URI, staging.dbName);
    } else {
      console.log('\n[3/3] Skipping sanitization (--skip-sanitize).');
    }

    console.log('\n[ok] Database sync completed successfully.\n');
  } catch (err) {
    console.error('\n[x] Database sync failed.');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    try {
      if (fs.existsSync(ARCHIVE)) fs.unlinkSync(ARCHIVE);
    } catch (cleanupErr) {
      console.warn(`[!] Could not delete archive ${ARCHIVE}: ${cleanupErr.message}`);
    }
  }
});

/**
 * Scrubs sensitive fields from the staging DB after restore.
 *
 * Edit this to match your actual schema. The intent is to make the
 * staging copy safe to use without exposing real users to whoever
 * has access to staging. Add collections / fields as needed.
 */
async function sanitizeStaging(uri, dbName) {
  let mongoose;
  try {
    mongoose = require('mongoose');
  } catch {
    console.warn(
      '[!] mongoose not installed; skipping sanitization. ' +
        'Re-run with --skip-sanitize to silence this warning.',
    );
    return;
  }

  await mongoose.connect(uri, { dbName });
  const db = mongoose.connection.db;

  // Example scrubs — adapt to your schema.
  const usersExists = await db.listCollections({ name: 'users' }).hasNext();
  if (usersExists) {
    const res = await db.collection('users').updateMany({}, [
      {
        $set: {
          email: {
            $concat: ['user_', { $toString: '$_id' }, '@staging.local'],
          },
          phone: null,
          resetPasswordToken: null,
          refreshToken: null,
        },
      },
    ]);
    console.log(`     - users sanitized: ${res.modifiedCount}`);
  }

  await mongoose.disconnect();
}
