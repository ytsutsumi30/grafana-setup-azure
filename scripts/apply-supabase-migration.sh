#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION_FILE="${1:?Usage: scripts/apply-supabase-migration.sh <migration.sql>}"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Migration file not found: $MIGRATION_FILE" >&2
  exit 1
fi

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Session Pooler connection string.}"

if command -v psql >/dev/null 2>&1; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f "$MIGRATION_FILE"
elif command -v node >/dev/null 2>&1 && [ -f "$ROOT/api/node_modules/pg/package.json" ]; then
  ROOT="$ROOT" MIGRATION_FILE="$MIGRATION_FILE" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(process.env.ROOT, 'api/node_modules/pg'));

async function applyMigration() {
  const databaseUrl = new URL(process.env.SUPABASE_DB_URL);
  databaseUrl.searchParams.delete('sslmode');
  databaseUrl.searchParams.delete('sslrootcert');

  const client = new Client({
    connectionString: databaseUrl.toString(),
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(process.env.MIGRATION_FILE, 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

applyMigration().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
NODE
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$MIGRATION_FILE:/migration.sql:ro" \
    postgres:17-alpine \
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f /migration.sql
else
  echo "Neither psql nor docker is available. Install one of them and retry." >&2
  exit 1
fi

echo "Supabase migration applied: $MIGRATION_FILE"
