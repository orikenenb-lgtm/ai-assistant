"""Command line utilities.

    python -m app.cli gen-key                      # print a new ORI_DATA_KEY
    python -m app.cli migrate                      # alembic upgrade head
    python -m app.cli create-owner --email you@example.com --name "אורי"
    python -m app.cli create-owner --email ... --name ... --password-env ORI_OWNER_PASSWORD
    python -m app.cli seed-demo                    # demo family members + sample trip (no users)

There is intentionally NO public sign-up: the first owner is created here and
everybody else joins through an owner-issued invitation.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import func, select

from app.core.config import API_ROOT, get_settings
from app.core.crypto import generate_key
from app.core.db import get_sessionmaker
from app.core.security import hash_password, validate_password_strength
from app.models.auth import ROLE_OWNER, User
from app.models.family import FamilyMember


def cmd_gen_key(_: argparse.Namespace) -> int:
    print(generate_key())
    return 0


def cmd_migrate(_: argparse.Namespace) -> int:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    command.upgrade(cfg, "head")
    print("✓ מסד הנתונים מעודכן (alembic head)")
    return 0


def cmd_create_owner(args: argparse.Namespace) -> int:
    email = args.email.strip().lower()
    if args.password_env:
        password = os.environ.get(args.password_env, "")
        if not password:
            print(f"✗ משתנה הסביבה {args.password_env} ריק", file=sys.stderr)
            return 2
    else:
        password = getpass.getpass("סיסמה לבעל/ת החשבון: ")
        if password != getpass.getpass("אימות סיסמה: "):
            print("✗ הסיסמאות אינן תואמות", file=sys.stderr)
            return 2
    err = validate_password_strength(password)
    if err:
        print(f"✗ {err}", file=sys.stderr)
        return 2
    with get_sessionmaker()() as db:
        owners = db.scalar(select(func.count()).select_from(User).where(User.role == ROLE_OWNER)) or 0
        if owners and not args.allow_additional:
            print("✗ כבר קיים בעל/ת חשבון. להוספת בעלים נוסף השתמשו ב- --allow-additional", file=sys.stderr)
            return 3
        if db.scalar(select(User).where(User.email == email)):
            print("✗ כבר קיים משתמש עם אימייל זה", file=sys.stderr)
            return 3
        user = User(
            email=email,
            display_name=args.name,
            role=ROLE_OWNER,
            password_hash=hash_password(password),
            legal_adult_attested=True,
            is_active=True,
        )
        db.add(user)
        db.flush()
        db.add(FamilyMember(display_name=args.name, user_id=user.id, age_group="adult", is_minor=False, created_by_id=user.id))
        db.commit()
    print(f"✓ נוצר/ה בעל/ת חשבון: {email}")
    return 0


def cmd_seed_demo(_: argparse.Namespace) -> int:
    settings = get_settings()
    if not settings.allow_demo_seed or settings.env == "production":
        print("✗ זריעת נתוני דמו מושבתת בסביבה זו", file=sys.stderr)
        return 2
    from app.seed import seed_demo  # optional module, provided by B1

    with get_sessionmaker()() as db:
        summary = seed_demo(db)
        db.commit()
    print(f"✓ נתוני דמו נוצרו: {summary}")
    return 0


def cmd_verify_providers(args: argparse.Namespace) -> int:
    from app.modules.providers.verify import verify_providers

    report = verify_providers(search=not args.no_search)
    for c in report.checks:
        print(f"{'✓' if c.ok else '✗'} {c.name}: {c.detail}")
    print("✓ כל הבדיקות עברו — Duffel (Sandbox) ו-ECB מחוברים" if report.ok else "✗ לא כל הבדיקות עברו — ראו למעלה")
    return 0 if report.ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Ori Travel AI utilities")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gen-key", help="Generate a new ORI_DATA_KEY").set_defaults(fn=cmd_gen_key)
    sub.add_parser("migrate", help="Apply database migrations").set_defaults(fn=cmd_migrate)
    p = sub.add_parser("create-owner", help="Create the family owner account")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--password-env", help="Read the password from this environment variable")
    p.add_argument("--allow-additional", action="store_true")
    p.set_defaults(fn=cmd_create_owner)
    sub.add_parser("seed-demo", help="Create demo family members and a sample trip").set_defaults(fn=cmd_seed_demo)
    v = sub.add_parser("verify-providers", help="Check Duffel sandbox + ECB against their real APIs (no secrets shown)")
    v.add_argument("--no-search", action="store_true", help="Skip the single TLV-ATH sandbox search")
    v.set_defaults(fn=cmd_verify_providers)
    args = parser.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    raise SystemExit(main())
