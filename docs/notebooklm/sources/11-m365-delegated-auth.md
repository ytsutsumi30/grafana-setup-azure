# Microsoft 365 Delegated Authentication

The shipping inspection app can optionally require Microsoft 365 sign-in by using MSAL in the browser and Microsoft Graph delegated tokens.

This implementation was adapted from `meeting-room-tool`:

- Browser acquires a Microsoft Graph delegated access token with MSAL.js.
- The shared frontend script attaches `Authorization: Bearer <token>` to same-origin application API calls.
- The API validates the token by calling Microsoft Graph `/me`.
- Tokens are not stored on the server. A short in-memory validation cache stores only a SHA-256 token hash and normalized user profile for 60 seconds.

## Azure App Registration

Create or reuse a Microsoft Entra app registration.

Authentication:

- Platform: Single-page application
- Redirect URI for local Docker: `http://localhost:8080`
- Redirect URI for Azure Container Apps: the current web URL, for example:
  `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io`
- Supported account types:
  - `AzureADMyOrg` when only users in the app tenant are allowed.
  - `AzureADMultipleOrgs` for the current POC, because users sign in from a different Microsoft 365 tenant.

API permissions:

- Microsoft Graph delegated permission: `User.Read`

Grant admin consent if your tenant policy requires it.

## Terraform Settings

Set these values in `infra/terraform/terraform.tfvars` when enabling the feature:

```hcl
m365_auth_enabled         = true
m365_auth_required        = true
m365_auth_tenant_id       = "<tenant-id-or-organizations>"
m365_auth_client_id       = "<client-id>"
m365_auth_scopes          = "User.Read"
m365_auth_allowed_domains = "example.com"
```

`m365_auth_allowed_domains` is optional. Leave it empty to allow any user accepted by the Entra app registration.

For the public Azure POC, write APIs are protected separately from full M365 sign-in:

```hcl
write_auth_mode = "enforce"
admin_api_token = "<strong-random-token>"
```

With `write_auth_mode = "enforce"`, all `POST` / `PUT` / `PATCH` / `DELETE` requests require either a valid M365 bearer token or `x-admin-token`. Read-only `GET` endpoints remain available unless `m365_auth_required = true` is also enabled.

## Current Azure POC

The Azure Container Apps POC currently uses this Entra app registration:

```text
Display name: shipping-inspection-poc
App home tenant ID: 25840d14-a711-4414-a32f-ff288351dd0a
Application (client) ID: 06bf7a06-fff0-40d1-a405-cb5c15c54221
Sign-in audience: AzureADMultipleOrgs
MSAL authority: https://login.microsoftonline.com/organizations
Redirect URIs:
- https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
- http://localhost:8080
Microsoft Graph delegated permission: User.Read
```

The public POC is configured with:

```hcl
m365_auth_enabled  = true
m365_auth_required = true
m365_auth_tenant_id = "organizations"
write_auth_mode    = "enforce"
```

In this mode, unauthenticated application API calls return `401`. Browser pages load normally, then `web/js/m365-auth.js` prompts for Microsoft 365 sign-in and retries same-origin API calls with `Authorization: Bearer <Graph access token>`.

Apply Terraform after changing the values:

```bash
cd infra/terraform
terraform plan
terraform apply
```

Then rebuild and deploy images as usual.

## Local Docker

Local Docker keeps M365 authentication disabled by default:

```yaml
M365_AUTH_ENABLED: "false"
M365_AUTH_REQUIRED: "false"
```

To test locally, edit `docker-compose.yml`:

```yaml
M365_AUTH_ENABLED: "true"
M365_AUTH_REQUIRED: "true"
M365_AUTH_TENANT_ID: "<tenant-id>"
M365_AUTH_CLIENT_ID: "<client-id>"
M365_AUTH_SCOPES: "User.Read"
```

Then restart:

```bash
docker compose down
docker compose up -d --build
```

## API Endpoints

- `GET /api/auth/m365/config`: frontend MSAL configuration
- `GET /api/auth/m365/me`: validates the provided Graph delegated token and returns the signed-in user

When `M365_AUTH_REQUIRED=true`, all application API routes except `/health` and `/auth/m365/*` require a valid Microsoft Graph delegated token.
