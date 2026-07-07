#!/usr/bin/env bash
#
# sync-prod-to-local.sh
#
# One-command clone of a REMOTE MongoDB (production by default) into your LOCAL
# MongoDB, so local testing uses data identical to production.
#
# What it does (exactly what was done by hand once):
#   1. mongodump the SOURCE database (MONGODB_URI_PROD by default).
#   2. Drop the LOCAL target database (MONGODB_URI).
#   3. mongorestore the dump into local, remapping the source db name to the
#      local db name (e.g. "saiban-db" -> "saiban_db"), restoring indexes too.
#   4. Verify per-collection document counts match between source and local.
#
# Usage:
#   npm run db:sync-from-prod                 # prod -> local (asks to confirm)
#   npm run db:sync-from-prod -- --yes        # skip the confirmation prompt
#   npm run db:sync-from-prod -- --staging    # use MONGODB_URI_STAGING as source
#   npm run db:sync-from-prod -- --source-uri "mongodb+srv://..."   # custom source
#   npm run db:sync-from-prod -- --clean      # delete this run's dump afterwards
#   npm run db:sync-from-prod -- --keep-dump  # keep it (default)
#   npm run db:sync-from-prod -- --retain 5   # keep newest 5 dumps (default 3)
#
# Dumps are stored under a single gitignored folder, ".db-dumps/", and rotated
# automatically so the project root stays clean (keeps the newest --retain).
# Wipe them all any time with:  npm run db:dumps:clean
#
# Reads from .env:
#   MONGODB_URI          -> LOCAL target (MUST be localhost/127.0.0.1)
#   MONGODB_URI_PROD     -> default source
#   MONGODB_URI_STAGING  -> source when --staging is passed
#
# SAFETY:
#   - This is DESTRUCTIVE to the local target (it drops the db). It is one-way:
#     nothing is ever written back to the source.
#   - It HARD-REFUSES to run if the target is not localhost/127.0.0.1, so it can
#     never wipe a remote/production database by mistake (override with --force,
#     which you should basically never need).
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Locate repo root (this script lives in <root>/scripts) and load .env
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; BOLD=$'\033[1m'; NC=$'\033[0m'
info()  { echo "${GREEN}[+]${NC} $*"; }
warn()  { echo "${YELLOW}[!]${NC} $*"; }
die()   { echo "${RED}[x] $*${NC}" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "No .env found at $ENV_FILE"

# Read a single KEY=VALUE from .env without executing it (values may contain
# spaces/quotes, e.g. SMTP_FROM), taking the first match and trimming quotes.
read_env() {
  local key="$1" line val
  line="$(grep -m1 -E "^${key}=" "$ENV_FILE" || true)"
  [ -n "$line" ] || return 1
  val="${line#*=}"
  val="${val%$'\r'}"                      # strip trailing CR (CRLF files)
  val="${val%\"}"; val="${val#\"}"       # strip surrounding double quotes
  val="${val%\'}"; val="${val#\'}"       # strip surrounding single quotes
  printf '%s' "$val"
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
ASSUME_YES=0
FORCE=0
CLEAN_DUMP=0
KEEP_DUMP=1
RETAIN=3
SOURCE_KIND="prod"
SOURCE_URI_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)        ASSUME_YES=1 ;;
    --force)         FORCE=1 ;;
    --clean)         CLEAN_DUMP=1; KEEP_DUMP=0 ;;
    --keep-dump)     KEEP_DUMP=1; CLEAN_DUMP=0 ;;
    --retain)        shift; RETAIN="${1:-}" ;;
    --staging)       SOURCE_KIND="staging" ;;
    --prod)          SOURCE_KIND="prod" ;;
    --source-uri)    shift; SOURCE_URI_OVERRIDE="${1:-}"; SOURCE_KIND="custom" ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
  shift
done

case "$RETAIN" in
  ''|*[!0-9]*) die "--retain must be a non-negative integer (got '$RETAIN')." ;;
esac

# All dumps live under one gitignored folder to keep the project root clean.
DUMP_ROOT="$ROOT_DIR/.db-dumps"

# Keep only the newest $RETAIN sync dumps; delete the rest.
prune_dumps() {
  local keep="$1" i=0 d
  [ -d "$DUMP_ROOT" ] || return 0
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    i=$((i + 1))
    if [ "$i" -gt "$keep" ]; then
      rm -rf "$d"
      warn "Pruned old dump: ${d#"$ROOT_DIR"/}"
    fi
  done < <(ls -1dt "$DUMP_ROOT"/*-sync-*/ 2>/dev/null || true)
}

# ---------------------------------------------------------------------------
# Preflight: required tools
# ---------------------------------------------------------------------------
for tool in mongodump mongorestore mongosh; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' not found on PATH. Install the MongoDB Database Tools + mongosh."
done

# ---------------------------------------------------------------------------
# Resolve URIs
# ---------------------------------------------------------------------------
TARGET_URI="$(read_env MONGODB_URI)" || die "MONGODB_URI missing from .env"

case "$SOURCE_KIND" in
  prod)    SOURCE_URI="$(read_env MONGODB_URI_PROD)"    || die "MONGODB_URI_PROD missing from .env" ;;
  staging) SOURCE_URI="$(read_env MONGODB_URI_STAGING)" || die "MONGODB_URI_STAGING missing from .env" ;;
  custom)  SOURCE_URI="$SOURCE_URI_OVERRIDE" ;;
esac
[ -n "${SOURCE_URI:-}" ] || die "Could not resolve a source URI."

# Extract host + db name from a mongodb URI (handles mongodb:// and mongodb+srv://).
uri_host() {
  local u="$1" rest afterat
  rest="${u#*://}"          # user:pass@host/db?...  |  host:port/db?...
  afterat="${rest##*@}"     # host/db?...            (strips creds if present)
  printf '%s' "${afterat%%/*}"
}
uri_db() {
  local u="$1" rest afterat noquery
  rest="${u#*://}"
  afterat="${rest##*@}"
  case "$afterat" in
    */*) noquery="${afterat%%\?*}"; printf '%s' "${noquery#*/}" ;;
    *)   printf '%s' "" ;;   # no db path in URI
  esac
}

# Return the URI with any "/<dbname>" path removed (keeps scheme, creds, host,
# and query string). mongorestore needs a db-less connection URI when using
# --nsFrom/--nsTo, otherwise it treats the path db as --db and skips the dump.
strip_db_from_uri() {
  local u="$1" base q pre hostpart hostonly
  base="${u%%\?*}"
  q=""
  [ "$base" != "$u" ] && q="?${u#*\?}"
  pre="${base%%://*}://"
  hostpart="${base#*://}"            # [creds@]host[/db]
  hostonly="${hostpart%%/*}"         # drop /db if present
  printf '%s%s%s' "$pre" "$hostonly" "$q"
}

SRC_HOST="$(uri_host "$SOURCE_URI")"
SRC_DB="$(uri_db "$SOURCE_URI")"
DST_HOST="$(uri_host "$TARGET_URI")"
DST_DB="$(uri_db "$TARGET_URI")"

[ -n "$SRC_DB" ] || die "Source URI has no database name (expected .../<dbname>). Got host '$SRC_HOST'."
[ -n "$DST_DB" ] || die "Target URI (MONGODB_URI) has no database name (expected .../<dbname>)."

# ---------------------------------------------------------------------------
# SAFETY GUARD: target MUST be local unless --force
# ---------------------------------------------------------------------------
case "$DST_HOST" in
  localhost*|127.0.0.1*|0.0.0.0*|"["*) IS_LOCAL=1 ;;
  *) IS_LOCAL=0 ;;
esac
if [ "$IS_LOCAL" -ne 1 ] && [ "$FORCE" -ne 1 ]; then
  die "Refusing to run: target MONGODB_URI host is '$DST_HOST', which is NOT localhost.
    This script DROPS the target database. Point MONGODB_URI at your local Mongo,
    or pass --force if you truly know what you're doing."
fi
# Never allow source == target (would drop what we just read).
if [ "$SOURCE_URI" = "$TARGET_URI" ]; then
  die "Source and target URIs are identical. That would drop the very db being dumped. Aborting."
fi

# ---------------------------------------------------------------------------
# Confirm (destructive to local)
# ---------------------------------------------------------------------------
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DUMP_ROOT"
DUMP_DIR="$DUMP_ROOT/${SOURCE_KIND}-sync-$STAMP"

echo
echo "${BOLD}About to sync MongoDB:${NC}"
echo "  source : $SRC_HOST  (db: ${BOLD}$SRC_DB${NC}, kind: $SOURCE_KIND)"
echo "  target : $DST_HOST  (db: ${BOLD}$DST_DB${NC})  ${RED}<- will be DROPPED and replaced${NC}"
echo "  dump   : $DUMP_DIR"
echo

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    die "Not a TTY and --yes not given. Re-run with -y/--yes to proceed non-interactively."
  fi
  read -r -p "Drop local '$DST_DB' and replace with '$SRC_DB' data? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) die "Cancelled." ;;
  esac
fi

# ---------------------------------------------------------------------------
# 1. Dump source
# ---------------------------------------------------------------------------
info "Dumping source ($SRC_DB) ..."
mongodump --uri="$SOURCE_URI" --out="$DUMP_DIR" >/dev/null

[ -d "$DUMP_DIR/$SRC_DB" ] || die "Dump produced no '$SRC_DB' folder under $DUMP_DIR."

# ---------------------------------------------------------------------------
# 2. Drop local target
# ---------------------------------------------------------------------------
info "Dropping local database '$DST_DB' ..."
mongosh "$TARGET_URI" --quiet --eval 'db.dropDatabase()' >/dev/null

# ---------------------------------------------------------------------------
# 3. Restore into local, remapping the db namespace
# ---------------------------------------------------------------------------
info "Restoring '$SRC_DB' -> '$DST_DB' (with indexes) ..."
TARGET_BASE_URI="$(strip_db_from_uri "$TARGET_URI")"
mongorestore --uri="$TARGET_BASE_URI" \
  --nsInclude="${SRC_DB}.*" \
  --nsFrom="${SRC_DB}.*" --nsTo="${DST_DB}.*" \
  --drop "$DUMP_DIR" >/dev/null

# ---------------------------------------------------------------------------
# 4. Verify counts
# ---------------------------------------------------------------------------
info "Verifying document counts ..."
count_script='const out=[];db.getCollectionNames().sort().forEach(c=>out.push(c+"\t"+db.getCollection(c).countDocuments()));print(out.join("\n"));'

SRC_COUNTS="$(mongosh "$SOURCE_URI" --quiet --eval "$count_script" 2>/dev/null || true)"
DST_COUNTS="$(mongosh "$TARGET_URI" --quiet --eval "$count_script" 2>/dev/null || true)"

echo
printf '%-32s %12s %12s\n' "collection" "source" "local"
printf '%-32s %12s %12s\n' "--------------------------------" "------------" "------------"
MISMATCH=0
# Union of collection names from both sides.
ALL_COLS="$(printf '%s\n%s\n' "$SRC_COUNTS" "$DST_COUNTS" | awk -F'\t' 'NF{print $1}' | sort -u)"
while IFS= read -r col; do
  [ -n "$col" ] || continue
  s="$(printf '%s\n' "$SRC_COUNTS" | awk -F'\t' -v c="$col" '$1==c{print $2}')"; s="${s:-0}"
  d="$(printf '%s\n' "$DST_COUNTS" | awk -F'\t' -v c="$col" '$1==c{print $2}')"; d="${d:-0}"
  mark=""
  if [ "$s" != "$d" ]; then mark="  <-- MISMATCH"; MISMATCH=1; fi
  printf '%-32s %12s %12s%s\n' "$col" "$s" "$d" "$mark"
done <<< "$ALL_COLS"
echo

# ---------------------------------------------------------------------------
# Cleanup + result
# ---------------------------------------------------------------------------
if [ "$CLEAN_DUMP" -eq 1 ]; then
  rm -rf "$DUMP_DIR"
  info "Removed this run's dump folder."
else
  info "Dump kept at: ${DUMP_DIR#"$ROOT_DIR"/} (gitignored)"
  prune_dumps "$RETAIN"
  info "Retaining newest $RETAIN dump(s) in .db-dumps/."
fi

if [ "$MISMATCH" -ne 0 ]; then
  die "Sync completed but counts differ (see MISMATCH above). Investigate before trusting local data."
fi

echo "${GREEN}${BOLD}Sync complete — local '$DST_DB' now matches source '$SRC_DB'.${NC}"
