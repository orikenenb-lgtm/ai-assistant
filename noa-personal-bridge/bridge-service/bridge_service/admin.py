"""Operator CLI. ``python -m bridge_service.admin <command>``.

Commands never print device tokens (the server does not have them — only their sha256), and
``export-persona`` never prints the persona text.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from bridge_service.config import Settings
from bridge_service.security.pairing import (
    generate_pairing_code,
    hash_pairing_code,
    resolve_pairing_pepper,
)
from bridge_service.storage.db import Database


def _fmt(ts: int | None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else "-"


def _fmt_day(ts: int | None) -> str:
    # last_seen_at has day granularity (UTC midnight); show it as a date only.
    return time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else "-"


def _db(settings: Settings) -> Database:
    db = Database(settings.db_path)
    db.migrate()
    return db


def cmd_init_db(settings: Settings, _: argparse.Namespace) -> int:
    db = Database(settings.db_path)
    applied = db.migrate()
    print(f"database: {settings.db_path}")
    print(f"schema version: {db.schema_version()} (applied now: {applied or 'none'})")
    return 0


def cmd_create_pairing_code(settings: Settings, args: argparse.Namespace) -> int:
    ttl_minutes = args.ttl_minutes if args.ttl_minutes is not None else settings.pairing_code_ttl_minutes
    if not 1 <= ttl_minutes <= 60:
        print("error: --ttl-minutes must be between 1 and 60", file=sys.stderr)
        return 2
    db = _db(settings)
    code = generate_pairing_code()
    pepper = resolve_pairing_pepper(settings.pairing_pepper, settings.db_path)
    expires_at = db.add_pairing_code(hash_pairing_code(code, pepper), ttl_minutes * 60)
    print(code)
    print(f"valid until {_fmt(expires_at)} ({ttl_minutes} min), single use", file=sys.stderr)
    if not settings.enabled:
        print("note: BRIDGE_ENABLED is false — /v1/pair will answer 503 until enabled", file=sys.stderr)
    return 0


def cmd_list_devices(settings: Settings, _: argparse.Namespace) -> int:
    devices = _db(settings).list_devices()
    if not devices:
        print("no devices")
        return 0
    print(f"{'id':<22} {'status':<8} {'created':<20} {'last seen':<20} name")
    for d in devices:
        status = "revoked" if d.revoked else "active"
        print(f"{d.id:<22} {status:<8} {_fmt(d.created_at):<20} {_fmt_day(d.last_seen_at):<20} {d.name}")
    return 0


def cmd_revoke_device(settings: Settings, args: argparse.Namespace) -> int:
    db = _db(settings)
    if db.get_device(args.device_id) is None:
        print(f"error: no such device: {args.device_id}", file=sys.stderr)
        return 1
    if db.revoke_device(args.device_id):
        print(f"revoked {args.device_id}")
    else:
        print(f"{args.device_id} was already revoked")
    return 0


def cmd_purge(settings: Settings, _: argparse.Namespace) -> int:
    result = _db(settings).purge()
    print(f"purged {result.devices} revoked device(s) (revoked > 30 days ago), "
          f"{result.pairing_codes} dead pairing code(s)")
    return 0


def _write_private(path: Path, text: str) -> None:
    """Write atomically with 0600 permissions (the persona is business configuration)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    os.chmod(path, 0o600)


def cmd_export_persona(settings: Settings, args: argparse.Namespace) -> int:
    """ONE POST to NOA's read-only /agents/{id}/prompt, written to --out (security review H-1)."""
    from bridge_service.ai.factory import _secret
    from bridge_service.ai.noa_persona_engine import (
        PERSONA_TIMEOUT_SECONDS,
        ForbiddenNoaEndpoint,
        PersonaFetchError,
        make_guarded_client,
        persona_url,
        request_persona,
    )

    key = _secret(settings.noa_engine_api_key)
    if not (settings.noa_engine_url and settings.noa_agent_id and key):
        print(
            "error: BRIDGE_NOA_ENGINE_URL, BRIDGE_NOA_AGENT_ID and BRIDGE_NOA_ENGINE_API_KEY "
            "must be set for this one-time export",
            file=sys.stderr,
        )
        return 2
    try:
        url = persona_url(settings.noa_engine_url.strip(), settings.noa_agent_id.strip())
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    async def fetch() -> str | None:
        client = make_guarded_client(url, PERSONA_TIMEOUT_SECONDS)
        try:
            return await request_persona(client, url, key)
        finally:
            await client.aclose()

    try:
        persona = asyncio.run(fetch())
    except (PersonaFetchError, ForbiddenNoaEndpoint) as exc:
        print(f"error: persona fetch failed: {exc}", file=sys.stderr)
        return 1
    if persona is None:
        print("error: NOA returned an empty persona (after removing placeholder lines)", file=sys.stderr)
        return 1
    out = Path(args.out)
    _write_private(out, persona)
    print(f"wrote persona ({len(persona)} chars) to {out}")
    print(
        f"next: set BRIDGE_PERSONA_FILE={out} and REMOVE BRIDGE_NOA_ENGINE_API_KEY from the "
        "bridge's environment; the bridge then never contacts NOA",
        file=sys.stderr,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m bridge_service.admin")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="create the database / apply migrations").set_defaults(
        func=cmd_init_db
    )
    p = sub.add_parser("create-pairing-code", help="print a one-time pairing code")
    p.add_argument("--ttl-minutes", type=int, default=None)
    p.set_defaults(func=cmd_create_pairing_code)
    sub.add_parser("list-devices", help="list paired devices (no tokens)").set_defaults(
        func=cmd_list_devices
    )
    p = sub.add_parser("revoke-device", help="revoke a device token")
    p.add_argument("device_id")
    p.set_defaults(func=cmd_revoke_device)
    sub.add_parser(
        "purge", help="delete devices revoked > 30 days ago and dead pairing codes"
    ).set_defaults(func=cmd_purge)
    p = sub.add_parser(
        "export-persona",
        help="fetch NOA's persona ONCE (read-only /prompt) into a file for BRIDGE_PERSONA_FILE",
    )
    p.add_argument("--out", required=True, help="file to write (created with 0600 permissions)")
    p.set_defaults(func=cmd_export_persona)
    return parser


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(settings or Settings(), args))


if __name__ == "__main__":
    raise SystemExit(main())
