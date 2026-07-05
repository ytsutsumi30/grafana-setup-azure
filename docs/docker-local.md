# Docker Local Run

This project can run locally with Docker Compose using the bundled PostgreSQL initialization SQL.

## Endpoint

- Web: `http://localhost:8080`
- API: `http://localhost:3002`
- PostgreSQL from host: `localhost:5433`

## Start

```bash
docker compose up -d --build
```

## Check

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/health
curl http://localhost:8080/api/db-test
curl http://localhost:8080/api/products
curl http://localhost:8080/api/shipping-instructions
curl http://localhost:8080/api/inspectors
```

## Stop

```bash
docker compose down
```

To remove local database data as well:

```bash
docker compose down -v
```

## Notes

- Local Docker uses the `postgres` service, not Supabase.
- Microsoft 365 authentication is disabled by default. See `docs/m365-delegated-auth.md` to enable it.
- The local database credentials are POC-only values defined in `docker-compose.yml`.
- Azure Terraform state, `terraform.tfvars`, and Supabase project metadata are not required for local Docker execution.
