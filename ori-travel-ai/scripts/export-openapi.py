#!/usr/bin/env python3
"""Export the API's OpenAPI document to packages/shared/openapi.json.

Run with the API virtualenv:  apps/api/.venv/bin/python scripts/export-openapi.py
(Windows: apps\\api\\.venv\\Scripts\\python scripts\\export-openapi.py)
Uses an in-memory DB and a throwaway key; no server, no network, no secrets.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps" / "api"
os.environ["ORI_ENV"] = "test"  # keep /api/openapi.json enabled, never read a real .env DB
os.environ["ORI_DATABASE_URL"] = "sqlite://"
os.environ["ORI_SERVE_WEB"] = "false"
os.environ.pop("ORI_DATA_KEY", None)
sys.path.insert(0, str(API))

from app.main import create_app  # noqa: E402

out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "packages" / "shared" / "openapi.json"
schema = create_app().openapi()
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"Wrote {out} ({len(schema.get('paths', {}))} paths)")
