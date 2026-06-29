#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Session Pooler connection string from the dashboard.}"

TFVARS="${1:-infra/terraform/terraform.tfvars}"
python3 - "$SUPABASE_DB_URL" "$TFVARS" <<'PY'
from pathlib import Path
from urllib.parse import urlparse, unquote
import re
import sys

url = sys.argv[1]
path = Path(sys.argv[2])
parsed = urlparse(url)
if not parsed.hostname or not parsed.username or not parsed.password:
    raise SystemExit("SUPABASE_DB_URL must include host, user, and password")

values = {
    "supabase_db_host": parsed.hostname,
    "supabase_db_port": str(parsed.port or 5432),
    "supabase_db_name": (parsed.path.lstrip("/") or "postgres"),
    "supabase_db_user": unquote(parsed.username),
    "supabase_db_password": unquote(parsed.password),
}

s = path.read_text()
for key, value in values.items():
    line = f'{key} = "{value}"'
    if re.search(rf'^{key}\s*=', s, re.M):
        s = re.sub(rf'^{key}\s*=.*$', line, s, flags=re.M)
    else:
        s += "\n" + line + "\n"
path.write_text(s)
print(f"Updated {path}")
print("Host:", values["supabase_db_host"])
print("User:", values["supabase_db_user"])
print("Database:", values["supabase_db_name"])
PY