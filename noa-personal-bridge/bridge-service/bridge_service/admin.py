"""Operator CLI. ``python -m bridge_service.admin <command>``.

Commands never print device tokens (the server does not have them — only their sha256).
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

from bridge_service.config import Settings
from bridge_service.security.pairing import generate_pairing_code, hash_pairing_code
from bridge_service.storage.db import Database


def _fmt(ts: int | None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else "-"


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
    expires_at = db.add_pairing_code(hash_pairing_code(code), ttl_minutes * 60)
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
        print(f"{d.id:<22} {status:<8} {_fmt(d.created_at):<20} {_fmt(d.last_seen_at):<20} {d.name}")
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
    return parser


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(settings or Settings(), args))


if __name__ == "__main__":
    raise SystemExit(main())
