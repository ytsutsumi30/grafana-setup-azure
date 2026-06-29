# Migration Assessment: Docker Compose / EC2 + RDS to Azure Container Apps + Supabase

Generated: 2026-06-29
Source: /home/tsutsumi/grafana-setup
Target workspace: /home/tsutsumi/grafana-setup-azure

## Summary

The current system is a Docker Compose based production management and shipping inspection app. It runs a Node.js/Express API, an nginx static frontend, PostgreSQL-compatible schema/data, and optional Grafana/Prometheus monitoring. Existing Terraform targets AWS EC2, RDS PostgreSQL, Route53, and optional GCP Document AI. The requested target is Azure Container Apps for the application runtime and Supabase for PostgreSQL.

Migration complexity: Medium

Reasons:
- The app is already container-friendly but currently relies on bind mounts and 
pm install at container startup.
- The database is standard PostgreSQL and should be portable to Supabase.
- Static frontend assumes same-origin /api routing through nginx, so Container Apps should preserve a reverse-proxy pattern or the frontend URLs must be rewritten.
- Some API endpoints use local filesystem paths and shell commands (pg_dump, log file reads), which are fragile in serverless containers unless persistent storage or alternative backup/logging behavior is designed.

## Source Components

| Component | Type | Technology | Source Path | Notes |
|-----------|------|------------|-------------|-------|
| nginx | Reverse proxy + static web | nginx:alpine | 
ginx, web | Serves static HTML/JS/CSS and proxies API in current model |
| production-api | API service | Node.js 18, Express, pg | pi | REST API with OCR routes and PostgreSQL access |
| database schema | PostgreSQL schema and seed data | SQL | postgres/init, pi/migrations | Uses standard PostgreSQL DDL/DML |
| grafana | Monitoring UI | Grafana | grafana | Optional Compose profile |
| prometheus | Metrics store | Prometheus | prometheus | Optional Compose profile |
| terraform | Existing cloud IaC | Terraform | 	erraform | AWS/GCP oriented, not reusable directly for Azure target |

## Target Mapping

| Source | Target | Decision |
|--------|--------|----------|
| EC2 + Docker Compose | Azure Container Apps Environment | Replace host-level Docker Compose with managed containers |
| nginx static site + reverse proxy | Container App running nginx | Preserve same-origin /api routing to reduce frontend changes |
| Node.js API container | Container App internal ingress | Build immutable image instead of runtime 
pm install |
| RDS PostgreSQL / local Postgres scripts | Supabase PostgreSQL | Apply schema SQL, migrate data with pg_dump/pg_restore or psql |
| Docker secrets bind mount | Container Apps secrets / Key Vault later | Avoid mounting local secrets/; use env vars and secret refs |
| Compose logs | Log Analytics | Use stdout/stderr instead of file logs for platform logging |
| Grafana/Prometheus | Optional: Azure Monitor first | Defer unless explicitly required |

## Container Findings

Current Compose exposes:
- nginx: ports 80 and 443
- production-api: port 3000 in Compose, while the app default is PORT || 3001
- Grafana/Prometheus are optional monitoring profiles

Recommended Container Apps shape:
- web external ingress on port 80, nginx serves /usr/share/nginx/html and proxies /api to pi
- pi internal ingress on port 3001, Node.js starts with 
pm start
- min replicas: 0 or 1 for POC; 1 recommended if iPhone/QR workflows need predictable warm response
- CPU/memory starting point: web 0.25 vCPU/0.5Gi, pi 0.5 vCPU/1Gi

Required container changes:
- Add pi/Dockerfile with 
pm ci --omit=dev at build time.
- Add web/Dockerfile or root nginx Dockerfile that copies web and nginx config into an image.
- Remove bind mounts from production deployment.
- Add .dockerignore to exclude 
ode_modules, logs, backups, secrets, SSL certs, and old backups.

## Database Findings

PostgreSQL schema files found:
- postgres/init/01-init.sql
- postgres/init/02-qr-inspection-tables.sql
- postgres/init/03-inspectors-table.sql
- postgres/init/03-new-qc-tools-tables.sql
- postgres/init/04-monitoring-tables.sql
- postgres/init/05-pps-lot-tables.sql
- pi/migrations/003_create_product_components_and_inventory.sql
- postgres/migrations/fix-prod001-qr-codes.sql
- postgres/scripts/insert-qc-sample-data.sql

Supabase approach:
1. Create a Supabase project in the preferred region.
2. Apply schema files in a controlled order.
3. Export current RDS data with pg_dump --data-only or full dump if replacing schema.
4. Import into Supabase using direct connection string.
5. Configure API secrets: DB_HOST, DB_PORT=5432, DB_NAME=postgres or selected DB, DB_USER, DB_PASSWORD, DB_SSL=true.

Compatibility notes:
- Uses generated columns and JSONB, which Supabase PostgreSQL supports.
- Existing GRANT statements reference production_user; these should be adjusted or removed for Supabase roles.
- Supabase Row Level Security should remain disabled for these server-side tables unless the frontend starts using Supabase client directly. This app currently uses server-side pg access.

## API Findings

The API is a single large Express server plus OCR route modules. It exposes health, products, production plans, shipping locations, delivery locations, shipping instructions, QR inspections, reports, QC tools, monitoring, inventory, database backup/restore, lot inventory, picking, packing, and system config endpoints.

Risk areas:
- winston.transports.File writes rror.log and combined.log; Container Apps filesystem is ephemeral. Prefer console-only logs or optional Azure Files mount.
- /database/backup uses pg_dump shell command and /app/backups; the Node image will not include pg_dump unless installed, and local backup files are ephemeral.
- /database/restore should be protected or disabled in public deployments unless authentication is added.
- Current app has no obvious authentication layer. External ingress should be restricted during POC or protected before production.
- OCR dependencies use AWS Textract and Google Document AI environment variables. These can remain cross-cloud, but secrets must move to Container Apps secrets or Key Vault.

## Frontend Findings

The frontend is static HTML/CSS/JS under web and mostly calls /api or same-origin /api. Preserving nginx as the external entrypoint avoids broad frontend rewrites.

Risk areas:
- Some pages use absolute same-origin construction with /api; compatible with nginx reverse proxy.
- pps.html uses const API = '' and calls root API paths such as /shipping-instructions; nginx should proxy both /api/* and known root API paths, or the page should be changed to /api.
- External CDN dependencies are used for Bootstrap, Font Awesome, QR scanner, Chart.js, Tailwind, etc. Production network policy should allow these or vendor them locally.

## Security Findings

Immediate issues to fix during migration:
- Plain DB credentials exist in docker-compose.yml; do not carry them forward.
- .env, pi/.env, and secrets/ must not be baked into images.
- Database backup/restore endpoints should be restricted.
- CORS is currently open; acceptable for same-origin POC but should be narrowed if API becomes public.
- No authentication was identified in the scanned API paths.

## Recommended Migration Plan

1. Build immutable Docker images for pi and web.
2. Create Supabase project and apply cleaned schema migrations.
3. Move secrets to Container Apps secrets.
4. Deploy Azure Container Registry, Log Analytics, Container Apps Environment, pi app, and web app.
5. Configure nginx to proxy /api and root API endpoints to the internal API app.
6. Validate /health, /db-test, product list, shipping instruction list, QR inspection flow, OCR flow if credentials are available.
7. Decide separately whether to migrate Grafana/Prometheus or replace with Azure Monitor dashboards.

## Open Decisions

| Decision | Recommendation | Needs User Confirmation |
|----------|----------------|-------------------------|
| Azure region | japaneast for Japan users | Yes |
| Environment class | POC / Development | Yes |
| Scale | Small | Yes |
| Budget profile | Cost-optimized | Yes |
| Grafana/Prometheus | Defer initially | Yes |
| Supabase project | Use existing project if available, otherwise create manually | Yes |
| Public access | External web app only, internal API | Yes |
