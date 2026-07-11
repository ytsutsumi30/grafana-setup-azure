# Supabase Migration Runbook

Target: Supabase PostgreSQL for the shipping inspection POC.

## 1. Create the Supabase project

This repo includes `scripts/create-supabase-project.sh`, which uses the Supabase Management API.

Required environment variables:

- Supabase personal access token
- Supabase organization ID
- Supabase database password
- Supabase project name
- Supabase region

Do not upload actual values to NotebookLM.

The script writes `supabase-project.json`. Wait until the project is active before applying schema.

## 2. Prepare schema SQL

```bash
./scripts/prepare-supabase-schema.sh
```

This creates `supabase-schema.sql` by concatenating the existing SQL files and removing `GRANT ALL PRIVILEGES` statements that reference the old `production_user` role.

## 3. Apply schema

Use the direct Supabase PostgreSQL connection string from Project Settings > Database.

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase-schema.sql
```

For Supabase, typical DB settings for the API are:

```text
DB_HOST=db.<project-ref>.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=<project password>
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
```

## 4. Migrate existing data from RDS

If you need current RDS data:

```bash
pg_dump "$OLD_DATABASE_URL" --data-only --inserts --no-owner --no-privileges > rds-data.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f rds-data.sql
```

If schema drift exists between RDS and these repo migrations, dump schema separately and compare first:

```bash
pg_dump "$OLD_DATABASE_URL" --schema-only --no-owner --no-privileges > rds-schema.sql
```

## 5. Verification

After Container Apps deployment, verify:

```bash
curl https://<web-url>/api/db-test
curl https://<web-url>/api/products
```

## Notes

- Keep Supabase Row Level Security disabled for these server-owned tables unless the frontend is rewritten to use Supabase directly.
- Do not expose the Supabase service credentials in frontend JavaScript.
- Database backup/restore endpoints in the API are suitable for POC only and should be protected before production use.
## IPv4-only WSL/Docker note

If direct connection fails with Network unreachable and an IPv6 address, use Supabase Session Pooler.

Set the database password and enable the pooler before running `scripts/apply-supabase-schema.sh`.

If the inferred pooler host is different from your dashboard, copy the Session pooler connection string from Supabase Dashboard > Connect and run:

Use a Session Pooler connection string from Supabase Dashboard > Connect, then run `scripts/apply-supabase-schema.sh`.


## Current Supabase Status

The Supabase project has been created and the application schema has been applied. The Azure API uses the Supabase Session Pooler, not the direct IPv6-only database endpoint.

Validated through:

```bash
curl https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/db-test
curl https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/products
```
