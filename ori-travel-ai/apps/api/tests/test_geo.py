"""GET /api/geo/airports (V6 §3): offline airport dataset for the combobox and the route map."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from app.modules.providers.data.geo import AIRPORTS, CITIES

KEYS = {"code", "city_code", "name_he", "name_en", "city_he", "city_en", "country_code", "lat", "lon", "timezone"}


def test_airports_require_auth(client):
    assert client.get("/api/geo/airports").status_code == 401


def test_airports_shape_and_content(auth_client):
    res = auth_client("viewer").get("/api/geo/airports")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "private, max-age=3600"
    items = res.json()
    assert isinstance(items, list) and len(items) == len(AIRPORTS)
    assert all(set(a) == KEYS for a in items)
    codes = [a["code"] for a in items]
    assert len(set(codes)) == len(codes) and codes[0] == "TLV"
    by_code = {a["code"]: a for a in items}
    tlv = by_code["TLV"]
    assert tlv == {"code": "TLV", "city_code": "TLV", "name_he": "נמל התעופה בן גוריון", "name_en": "Ben Gurion Airport",
                   "city_he": "תל אביב", "city_en": "Tel Aviv", "country_code": "IL", "lat": 32.0114, "lon": 34.8867,
                   "timezone": "Asia/Jerusalem"}
    fco = by_code["FCO"]
    assert (fco["city_code"], fco["city_he"], fco["country_code"], fco["timezone"]) == ("ROM", "רומא", "IT", "Europe/Rome")
    for a in items:
        assert a["city_code"] in CITIES and -90 <= a["lat"] <= 90 and -180 <= a["lon"] <= 180
        assert isinstance(a["lat"], float) and isinstance(a["lon"], float)
        assert ZoneInfo(a["timezone"])
        assert len(a["country_code"]) == 2 and a["name_he"] and a["city_en"]


def test_airports_list_is_stable(auth_client):
    c = auth_client("adult")
    assert c.get("/api/geo/airports").json() == c.get("/api/geo/airports").json()
