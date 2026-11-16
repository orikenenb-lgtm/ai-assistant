import os
import sqlite3
import stat

from bridge_service.storage.db import MIGRATIONS, Database
from bridge_service.storage.memory import StoreFull, TTLStore


def test_migrations_are_idempotent(tmp_path):
    db = Database(tmp_path / "sub" / "b.sqlite3")
    assert db.migrate() == [v for v, _ in MIGRATIONS]
    assert db.migrate() == []
    assert db.schema_version() == MIGRATIONS[-1][0]


def test_wal_mode_and_permissions(tmp_path):
    path = tmp_path / "d" / "b.sqlite3"
    Database(path).migrate()
    conn = sqlite3.connect(path)
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    conn.close()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(path.parent).st_mode) == 0o700


def test_pairing_code_single_use_and_expiry(tmp_path):
    db = Database(tmp_path / "b.sqlite3")
    db.migrate()
    db.add_pairing_code("h1", 600)
    assert db.redeem_pairing_code("h1", "dev_1", "t1", "A") is True
    assert db.redeem_pairing_code("h1", "dev_2", "t2", "B") is False
    db.add_pairing_code("h2", -1)
    assert db.redeem_pairing_code("h2", "dev_3", "t3", "C") is False
    assert db.redeem_pairing_code("nope", "dev_4", "t4", "D") is False
    assert [d.id for d in db.list_devices()] == ["dev_1"]


def test_failed_device_insert_rolls_back_code(tmp_path):
    db = Database(tmp_path / "b.sqlite3")
    db.migrate()
    db.add_pairing_code("h1", 600)
    db.add_pairing_code("h2", 600)
    assert db.redeem_pairing_code("h1", "dev_1", "same-hash", "A")
    try:
        db.redeem_pairing_code("h2", "dev_2", "same-hash", "B")  # UNIQUE violation
    except sqlite3.IntegrityError:
        pass
    # h2 must still be redeemable since the transaction rolled back.
    assert db.redeem_pairing_code("h2", "dev_3", "other", "C")


def test_device_lookup_touch_revoke(tmp_path):
    db = Database(tmp_path / "b.sqlite3")
    db.migrate()
    db.add_pairing_code("h", 600)
    db.redeem_pairing_code("h", "dev_x", "tokhash", "Phone")
    dev = db.get_device_by_token_hash("tokhash")
    assert dev is not None and dev.name == "Phone" and not dev.revoked
    db.touch_device("dev_x", min_interval_seconds=0)
    assert db.revoke_device("dev_x") is True
    assert db.revoke_device("dev_x") is False
    assert db.get_device("dev_x").revoked
    assert db.get_device_by_token_hash("missing") is None


def test_ttl_store_expiry_and_bounds():
    now = {"t": 0.0}
    store: TTLStore[str] = TTLStore(3, clock=lambda: now["t"])
    store.set("a", "1", 10)
    assert store.get("a") == "1"
    now["t"] = 11
    assert store.get("a") is None
    for k in "bcde":
        store.set(k, k, 10)
    assert len(store) == 3 and store.get("b") is None  # oldest evicted


def test_ttl_store_add_if_absent_fails_closed():
    now = {"t": 0.0}
    store: TTLStore[bool] = TTLStore(2, clock=lambda: now["t"])
    assert store.add_if_absent("a", True, 10)
    assert not store.add_if_absent("a", True, 10)
    assert store.add_if_absent("b", True, 10)
    try:
        store.add_if_absent("c", True, 10)
        raise AssertionError("expected StoreFull")
    except StoreFull:
        pass
    now["t"] = 20
    assert store.add_if_absent("c", True, 10)  # expired entries make room


def test_ttl_store_delete_where():
    store: TTLStore[int] = TTLStore(10)
    store.set(("d1", "r1"), 1, 60)
    store.set(("d2", "r1"), 2, 60)
    assert store.delete_where(lambda k: k[0] == "d1") == 1
    assert store.get(("d2", "r1")) == 2
