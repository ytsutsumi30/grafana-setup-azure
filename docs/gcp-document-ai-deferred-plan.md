# Deferred GCP Document AI Plan

GCP Document AI is intentionally deferred for the POC migration.

## Current code behavior

`api/services/documentai.js` initializes only when these variables are set:

```text
GCP_PROJECT_ID
DOCUMENTAI_PROCESSOR_ID
GOOGLE_APPLICATION_CREDENTIALS
```

If they are absent, Document AI endpoints return a 503-style configuration message instead of blocking API startup.

## Later enablement plan

1. Create or reuse a GCP Document AI processor.
2. Store credentials securely. Prefer workload identity federation long term; for a quick POC, use a service account JSON secret.
3. Update Container Apps secrets and env vars:

```text
enableGcpDocumentAi=true
GCP_PROJECT_ID=<project id>
DOCUMENTAI_PROCESSOR_ID=<processor id>
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/documentai-key.json
```

4. Decide how to mount/provide the JSON credential. Container Apps secrets as environment variables are simpler than file paths; if keeping file-path code, add a startup script that writes the secret value to a temp file.
5. Test:

```bash
curl https://<web-url>/api/ocr/health
```

## Recommendation

For the initial POC, keep Document AI disabled and validate the core shipping inspection workflow first.