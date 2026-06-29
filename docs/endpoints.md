# Current Endpoints

Last updated: 2026-06-29

## Public Web Endpoint

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

Open this URL in a browser to use the migrated application.

## API Endpoints

The API is exposed through the web app reverse proxy under `/api`.

| Purpose | Endpoint |
|---------|----------|
| Web health | `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/health` |
| API health | `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/health` |
| DB connectivity | `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/db-test` |
| Products | `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/products` |
| Shipping instructions | `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/shipping-instructions` |
| Inspectors | `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/api/inspectors` |

## Internal API FQDN

The API app is internal to the Container Apps environment:

```text
shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

External clients should use the public web endpoint with `/api/...`.

## Validation Commands

```bash
WEB_URL="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io"
curl "$WEB_URL/health"
curl "$WEB_URL/api/health"
curl "$WEB_URL/api/db-test"
curl "$WEB_URL/api/products"
curl "$WEB_URL/api/shipping-instructions"
curl "$WEB_URL/api/inspectors"
```

Expected current status:

- Web health: returns `healthy`
- API health: returns JSON status `OK`
- DB test: returns `Database connected`
- Business APIs: return seeded Supabase data