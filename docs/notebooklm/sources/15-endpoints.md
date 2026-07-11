# Current Endpoints

Last updated: 2026-07-08

## Public Web Endpoint

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

Open this URL in a browser to use the migrated application.

## API Access Pattern

The API Container App is internal. External clients should call API routes through the public web app reverse proxy under `/api`.

Internal API FQDN:

```text
shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

## Public Checks

| Purpose | Endpoint | Expected |
|---------|----------|----------|
| Web page | `/index.html` | `200` |
| Web health | `/health` | `healthy` |
| M365 config | `/api/auth/m365/config` | `200` JSON |
| Protected history API without token | `/api/shipping-instructions/1/history` | `401` |

## Authenticated API Examples

After M365 login, the browser adds a Bearer token to same-origin API requests.

Representative API paths:

| Purpose | API path |
|---------|----------|
| Products | `/api/products` |
| Shipping instructions | `/api/shipping-instructions` |
| Shipping instruction lines | `/api/shipping-instructions/:id/lines` |
| PPS status | `/api/shipping-instructions/:id/pps-status` |
| Completion status | `/api/shipping-instructions/:id/completion-status` |
| Shipping history | `/api/shipping-instructions/:id/history` |
| Report event | `/api/shipping-instructions/:id/report-events` |
| Inspectors | `/api/inspectors` |

## Validation Commands

```bash
WEB_URL="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io"
curl -i "$WEB_URL/index.html"
curl -i "$WEB_URL/health"
curl -i "$WEB_URL/api/auth/m365/config"
curl -i "$WEB_URL/api/shipping-instructions/1/history"
```

Expected unauthenticated status:

- `/index.html`: `200`
- `/health`: `200`
- `/api/auth/m365/config`: `200`
- `/api/shipping-instructions/1/history`: `401`
