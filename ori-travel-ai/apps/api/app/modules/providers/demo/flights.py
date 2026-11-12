"""DEMO flight adapters: "דמו סקייליין" (demo_skyline) and "דמו אורורה" (demo_aurora).

Real airports/time zones/great-circle distances; FICTIONAL airlines (codes
D1-D5, names suffixed "(דמו)"). Both providers resell a shared deterministic
"market" schedule, so the same flight numbers/times/fare brand appear at both
(at slightly different prices) and get merged by dedupe, while fare brands
that only one provider sells (e.g. "לייט" at Skyline) stay separate.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any, ClassVar

from app.modules.providers.base import ProviderUnsupportedError
from app.modules.providers.data.geo import (
    AIRPORTS,
    Airport,
    airport_distance_km,
    airport_zone,
    city_of_airport,
    local_datetime,
    resolve_airport,
)
from app.modules.providers.demo.common import (
    DemoAdapter,
    dec,
    round_dec,
    season_factor,
    seeded_rng,
    split_travellers,
    supplier_id,
    unit,
    usd,
)
from app.schemas.common import ApiModel, Category
from app.schemas.search import FlightSearchParams


@dataclass(frozen=True)
class Carrier:
    code: str
    name_he: str
    kind: str  # "full" | "low_cost"
    hubs: tuple[str, ...]
    price_factor: Decimal
    cabins: tuple[str, ...]


@dataclass(frozen=True)
class FareBrand:
    code: str
    name: str  # Hebrew display name; identical across resellers (dedupe relies on it)
    multiplier: Decimal
    carry_on: int
    checked: int
    checked_kg: int | None
    refundable: bool
    changeable: bool
    change_fee_usd: Decimal | None


_ALL_CABINS = ("economy", "premium_economy", "business", "first")

CARRIERS: dict[str, Carrier] = {
    "D1": Carrier("D1", "אוריון אייר (דמו)", "full", ("TLV",), Decimal("1.08"), _ALL_CABINS),
    "D2": Carrier("D2", "כחול-ים איירליינס (דמו)", "full", ("ATH", "LCA"), Decimal("0.96"), ("economy", "business")),
    "D3": Carrier("D3", "אלפא ג'ט (דמו)", "low_cost", ("BUD", "WAW"), Decimal("0.72"), ("economy",)),
    "D4": Carrier("D4", "מרידיאן איירווייז (דמו)", "full", ("VIE", "FRA", "MUC", "ZRH", "AMS"), Decimal("1.0"),
                  ("economy", "premium_economy", "business")),
    "D5": Carrier("D5", "סהר אייר (דמו)", "full", ("DXB", "AUH"), Decimal("0.97"), _ALL_CABINS),
}

BRANDS: dict[tuple[str, str], tuple[FareBrand, ...]] = {
    ("full", "economy"): (
        FareBrand("ECO_LIGHT", "לייט", Decimal("1.0"), 1, 0, None, False, True, Decimal("75")),
        FareBrand("ECO_CLASSIC", "קלאסיק", Decimal("1.22"), 1, 1, 23, False, True, Decimal("40")),
        FareBrand("ECO_FLEX", "פלקס", Decimal("1.6"), 1, 1, 23, True, True, None),
    ),
    ("low_cost", "economy"): (
        FareBrand("LC_BASIC", "בייסיק", Decimal("1.0"), 0, 0, None, False, False, None),
        FareBrand("LC_PLUS", "פלוס", Decimal("1.38"), 1, 1, 20, False, True, Decimal("45")),
    ),
    ("full", "premium_economy"): (
        FareBrand("PE_STANDARD", "פרימיום", Decimal("1.0"), 1, 2, 23, False, True, Decimal("50")),
        FareBrand("PE_FLEX", "פרימיום פלקס", Decimal("1.3"), 1, 2, 23, True, True, None),
    ),
    ("full", "business"): (
        FareBrand("BIZ_SAVER", "ביזנס", Decimal("1.0"), 2, 2, 32, False, True, Decimal("100")),
        FareBrand("BIZ_FLEX", "ביזנס פלקס", Decimal("1.35"), 2, 2, 32, True, True, None),
    ),
    ("full", "first"): (FareBrand("FIRST", "פירסט", Decimal("1.0"), 2, 3, 32, True, True, None),),
}

CABIN_FACTOR = {"economy": Decimal("1"), "premium_economy": Decimal("1.7"), "business": Decimal("3.6"), "first": Decimal("6")}
# Monday..Sunday departure-day factor (Thu/Sun peaks for Israeli travel)
WEEKDAY_FACTOR = (Decimal("0.97"), Decimal("0.94"), Decimal("0.94"), Decimal("1.06"), Decimal("1.04"),
                  Decimal("0.98"), Decimal("1.06"))
LAYOVERS = (65, 80, 95, 110, 140, 170, 215)
BAG_FEE_USD = Decimal("40")  # estimate per extra checked bag per passenger per direction


@dataclass(frozen=True)
class Leg:
    carrier: str
    flight_number: str
    origin: str
    destination: str
    departing_at: datetime
    arriving_at: datetime
    minutes: int
    aircraft: str


@dataclass(frozen=True)
class Itinerary:
    carrier: str
    legs: tuple[Leg, ...]
    layovers: tuple[int, ...]
    factor: Decimal
    day: date

    @property
    def stops(self) -> int:
        return len(self.legs) - 1

    @property
    def duration_minutes(self) -> int:
        return int((self.legs[-1].arriving_at - self.legs[0].departing_at).total_seconds() // 60)

    @property
    def key(self) -> str:
        return "/".join(f"{lg.carrier}{lg.flight_number}@{lg.departing_at.astimezone(UTC):%Y%m%dT%H%M}" for lg in self.legs)


def block_minutes(distance_km: float) -> int:
    """Gate-to-gate time: 30 min taxi/climb + cruise at ~780 km/h, rounded to 5 minutes."""
    raw = 30 + distance_km / 780 * 60
    return int(round(raw / 5) * 5)


def _aircraft(distance_km: float, rng) -> str:
    if distance_km < 2500:
        return rng.choice(("Airbus A320neo", "Boeing 737-800", "Airbus A220-300"))
    if distance_km < 6000:
        return rng.choice(("Airbus A321LR", "Boeing 737 MAX 8", "Airbus A321neo"))
    return rng.choice(("Boeing 787-9", "Airbus A350-900", "Boeing 777-300ER"))


def _is_israel(a: Airport) -> bool:
    return city_of_airport(a).country_code == "IL"


def _nonstop_ok(carrier: Carrier, o: Airport, d: Airport, dist: float) -> bool:
    if carrier.code == "D1":
        return (_is_israel(o) or _is_israel(d)) and dist <= 12500
    if carrier.code == "D2":
        regional = {"GR", "CY", "IL"}
        return dist <= 3000 and (
            o.iata in carrier.hubs or d.iata in carrier.hubs
            or city_of_airport(o).country_code in regional or city_of_airport(d).country_code in regional
        )
    if carrier.code == "D3":
        return dist <= 4200
    return (o.iata in carrier.hubs or d.iata in carrier.hubs) and dist <= (9500 if carrier.code == "D4" else 12500)


def _best_hub(carrier: Carrier, o: Airport, d: Airport, dist: float) -> Airport | None:
    best: tuple[float, str] | None = None
    max_ratio = 1.25 if dist > 6000 else 1.4
    for code in carrier.hubs:
        if code in (o.iata, d.iata):
            continue
        hub = AIRPORTS[code]
        if city_of_airport(hub).code in (o.city_code, d.city_code):
            continue
        d1, d2 = airport_distance_km(o, hub), airport_distance_km(hub, d)
        if d1 < 300 or d2 < 300:
            continue
        ratio = (d1 + d2) / max(dist, 1.0)
        if ratio <= max_ratio and (best is None or (ratio, code) < best):
            best = (ratio, code)
    return AIRPORTS[best[1]] if best else None


def _make_leg(carrier: Carrier, rng, a: Airport, b: Airport, dep_local: datetime) -> Leg:
    dist = airport_distance_km(a, b)
    minutes = block_minutes(dist)
    arr_local = (dep_local.astimezone(UTC) + timedelta(minutes=minutes)).astimezone(airport_zone(b))
    return Leg(carrier.code, str(rng.randrange(101, 989)), a.iata, b.iata, dep_local, arr_local, minutes, _aircraft(dist, rng))


@lru_cache(maxsize=512)
def market(origin: str, destination: str, day: date, cabin: str) -> tuple[Itinerary, ...]:
    """Deterministic shared schedule for one route/day/cabin (seeded by route + date only)."""
    o, d = AIRPORTS[origin], AIRPORTS[destination]
    rng = seeded_rng("flight-market", o.iata, d.iata, day.isoformat())
    dist = airport_distance_km(o, d)
    itineraries: list[Itinerary] = []
    for code in sorted(CARRIERS):
        carrier = CARRIERS[code]
        if cabin not in carrier.cabins or not _nonstop_ok(carrier, o, d, dist):
            continue
        if code != "D1" and rng.random() >= 0.8:
            continue
        departures = 1 if dist > 6000 else (2 if rng.random() < 0.55 else 1)
        for _ in range(departures):
            dep = local_datetime(day, rng.randrange(330, 1420, 5), airport_zone(o))
            leg = _make_leg(carrier, rng, o, d, dep)
            itineraries.append(Itinerary(code, (leg,), (), round_dec(dec(rng.uniform(0.86, 1.2))), day))
    connections = 0
    for code in sorted(CARRIERS):
        carrier = CARRIERS[code]
        if cabin not in carrier.cabins or connections >= 3:
            continue
        hub = _best_hub(carrier, o, d, dist)
        if hub is None or rng.random() >= 0.85:
            continue
        dep1 = local_datetime(day, rng.randrange(330, 1380, 5), airport_zone(o))
        leg1 = _make_leg(carrier, rng, o, hub, dep1)
        layover = rng.choice(LAYOVERS)
        dep2 = (leg1.arriving_at + timedelta(minutes=layover)).astimezone(airport_zone(hub))
        leg2 = _make_leg(carrier, rng, hub, d, dep2)
        itineraries.append(Itinerary(code, (leg1, leg2), (layover,), round_dec(dec(rng.uniform(0.86, 1.2))), day))
        connections += 1
    return tuple(itineraries)


def _base_fare_usd(itin: Itinerary, cabin: str, brand: FareBrand) -> Decimal:
    o, d = AIRPORTS[itin.legs[0].origin], AIRPORTS[itin.legs[-1].destination]
    dist = dec(round(airport_distance_km(o, d)))
    base = Decimal(40) + Decimal("0.075") * min(dist, Decimal(3000)) + Decimal("0.04") * max(dist - 3000, Decimal(0))
    carrier = CARRIERS[itin.carrier]
    f = carrier.price_factor * season_factor(itin.day) * WEEKDAY_FACTOR[itin.day.weekday()] * itin.factor
    f *= CABIN_FACTOR[cabin] * brand.multiplier
    if itin.stops:
        f *= Decimal("0.88")
    return round_dec(base * f, "0.01")


def _taxes_usd(itin: Itinerary, base: Decimal) -> Decimal:
    o, d = AIRPORTS[itin.legs[0].origin], AIRPORTS[itin.legs[-1].destination]
    dist = dec(round(airport_distance_km(o, d)))
    return round_dec(Decimal(25) + Decimal("0.12") * base + min(Decimal("0.015") * dist, Decimal(90)), "0.01")


def _slice_dict(itin: Itinerary, cabin: str) -> dict[str, Any]:
    carrier = CARRIERS[itin.carrier]
    segments = []
    for leg in itin.legs:
        a, b = AIRPORTS[leg.origin], AIRPORTS[leg.destination]
        segments.append(
            {
                "carrier_code": leg.carrier,
                "carrier_name": carrier.name_he,
                "flight_number": leg.flight_number,
                "origin": a.iata,
                "origin_name": a.name_he,
                "destination": b.iata,
                "destination_name": b.name_he,
                "departing_at": leg.departing_at,
                "arriving_at": leg.arriving_at,
                "duration_minutes": leg.minutes,
                "cabin": cabin,
                "aircraft": leg.aircraft,
                "operating_carrier_name": None,
            }
        )
    return {
        "origin": itin.legs[0].origin,
        "destination": itin.legs[-1].destination,
        "departing_at": itin.legs[0].departing_at,
        "arriving_at": itin.legs[-1].arriving_at,
        "duration_minutes": itin.duration_minutes,
        "stops": itin.stops,
        "segments": segments,
        "layovers_minutes": list(itin.layovers),
    }


def _baggage(brand: FareBrand, has_infant: bool) -> dict[str, Any]:
    notes = ["תיק אישי + טרולי לתא הנוסעים" if brand.carry_on else "תיק אישי בלבד (מתחת למושב)"]
    if brand.checked:
        notes.append(f"{brand.checked} מזוודות לבטן עד {brand.checked_kg} ק\"ג לנוסע" if brand.checked > 1
                     else f"מזוודה לבטן עד {brand.checked_kg} ק\"ג לנוסע")
    else:
        notes.append("ללא מזוודה לבטן")
    if has_infant:
        notes.append("תינוק: ללא מושב וללא מזוודה; עגלה ללא תשלום")
    return {
        "personal_item": True,
        "carry_on_included": brand.carry_on,
        "checked_included": brand.checked,
        "checked_bag_weight_kg": brand.checked_kg,
        "notes": "; ".join(notes),
    }


class DemoFlightAdapter(DemoAdapter):
    categories: ClassVar[tuple[Category, ...]] = ("flight",)
    default_max_results = 24
    carriers: ClassVar[frozenset[str]] = frozenset()
    excluded_brands: ClassVar[frozenset[str]] = frozenset()
    markup_range: ClassVar[tuple[float, float]] = (0.0, 0.0)
    service_fee_usd: ClassVar[Decimal] = Decimal(0)

    def generate(self, category: Category, params: ApiModel) -> list[dict[str, Any]]:
        assert isinstance(params, FlightSearchParams)
        o = resolve_airport(params.origin)
        d = resolve_airport(params.destination)
        if o is None or d is None:
            raise ProviderUnsupportedError("קוד שדה התעופה אינו נתמך בנתוני ההדגמה", code="UNSUPPORTED_LOCATION")
        if o.city_code == d.city_code:
            raise ProviderUnsupportedError("מוצא ויעד באותה עיר", code="UNSUPPORTED_LOCATION")
        pax = split_travellers(params.adults, params.children_ages)
        today = date.today()
        payloads: list[dict[str, Any]] = []
        for shift in range(-params.flex_days, params.flex_days + 1):
            dep_day = params.depart_date + timedelta(days=shift)
            ret_day = params.return_date + timedelta(days=shift) if params.return_date else None
            if dep_day < today:
                continue
            outbound = market(o.iata, d.iata, dep_day, params.cabin)
            inbound = market(d.iata, o.iata, ret_day, params.cabin) if ret_day else None
            for combo in self._combos(outbound, inbound):
                carrier = CARRIERS[combo[0].carrier]
                if carrier.code not in self.carriers:
                    continue
                for brand in BRANDS.get((carrier.kind, params.cabin), ()):
                    if brand.code in self.excluded_brands:
                        continue
                    payloads.append(self._build(params, combo, brand, pax))
        payloads.sort(key=lambda p: (Decimal(p["sort_total"]), p["supplier_offer_id"]))
        return payloads

    @staticmethod
    def _combos(outbound: tuple[Itinerary, ...], inbound: tuple[Itinerary, ...] | None) -> list[tuple[Itinerary, ...]]:
        if inbound is None:
            return [(it,) for it in outbound]
        combos: list[tuple[Itinerary, ...]] = []
        for code in sorted({it.carrier for it in outbound} & {it.carrier for it in inbound}):
            outs = [it for it in outbound if it.carrier == code][:2]
            ins = [it for it in inbound if it.carrier == code][:2]
            pairs = [(a, b) for a in outs for b in ins][:3]
            combos.extend(pairs)
        return combos

    def _build(self, params: FlightSearchParams, combo: tuple[Itinerary, ...], brand: FareBrand,
               pax: dict[str, int]) -> dict[str, Any]:
        cur = params.currency
        cabin = params.cabin
        carrier = CARRIERS[combo[0].carrier]
        combo_key = "|".join(it.key for it in combo)
        lo, hi = self.markup_range
        markup = round_dec(Decimal(1) + dec(lo + (hi - lo) * unit(self.provider_id, combo_key, brand.code, cabin)))

        base_adult = sum((_base_fare_usd(it, cabin, brand) for it in combo), Decimal(0))
        tax_adult = sum((_taxes_usd(it, _base_fare_usd(it, cabin, brand)) for it in combo), Decimal(0))
        ratios = {"adult": (Decimal(1), Decimal(1)), "child": (Decimal("0.75"), Decimal(1)),
                  "infant": (Decimal("0.10"), Decimal("0.2"))}
        labels = {"adult": "מבוגר", "child": "ילד", "infant": "תינוק"}
        components: list[dict[str, Any]] = []
        tax_usd = Decimal(0)
        for ptype in ("adult", "child", "infant"):
            n = pax[ptype]
            if not n:
                continue
            base_ratio, tax_ratio = ratios[ptype]
            amount = usd(base_adult * base_ratio * markup * n, cur)
            components.append({"label": f"תעריף בסיס — {labels[ptype]} ×{n}", "kind": "base", "amount": amount})
            tax_usd += tax_adult * tax_ratio * n
        components.append({"label": "מיסים והיטלים", "kind": "tax", "amount": usd(tax_usd, cur)})
        paying = pax["adult"] + pax["child"]
        if self.service_fee_usd:
            components.append(
                {"label": "דמי שירות של הספק", "kind": "fee", "amount": usd(self.service_fee_usd * paying, cur)}
            )
        warnings: list[str] = []
        excluded_notes: list[str] = []
        missing_bags = max(0, params.checked_bags - brand.checked)
        if missing_bags:
            est = usd(BAG_FEE_USD * missing_bags * paying * len(combo), cur)
            components.append(
                {"label": "מזוודות לבטן נוספות (הערכה)", "kind": "extra", "amount": est, "status": "estimated",
                 "included": False}
            )
            note = f"התעריף כולל {brand.checked} מזוודות לבטן לנוסע — מזוודות נוספות בתשלום נוסף שאינו כלול במחיר (הערכה)"
            excluded_notes.append(note)
            warnings.append(note)
        total = sum((c["amount"] for c in components if c.get("included", True)), Decimal(0))

        first_dep = combo[0].legs[0].departing_at
        if brand.refundable:
            cancellation = {"refundable": True, "free_cancellation_until": first_dep, "changeable": True,
                            "change_fee": None,
                            "policy_text": "ניתן לבטל עד מועד ההמראה ולקבל החזר מלא; שינויים ללא דמי שינוי (תנאי הדגמה)"}
        elif brand.changeable:
            fee = usd(brand.change_fee_usd or Decimal(0), cur)
            cancellation = {"refundable": False, "free_cancellation_until": None, "changeable": True,
                            "change_fee": fee,
                            "policy_text": f"ללא החזר כספי. שינוי תאריך בתוספת {fee} {cur} לנוסע + הפרש מחיר (תנאי הדגמה)"}
        else:
            cancellation = {"refundable": False, "free_cancellation_until": None, "changeable": False,
                            "change_fee": None, "policy_text": "ללא החזר וללא אפשרות שינוי (תנאי הדגמה)"}

        o_city = city_of_airport(AIRPORTS[combo[0].legs[0].origin])
        d_city = city_of_airport(AIRPORTS[combo[0].legs[-1].destination])
        max_stops = max(it.stops for it in combo)
        stops_text = "ישירה" if max_stops == 0 else ("עצירת ביניים אחת" if max_stops == 1 else f"{max_stops} עצירות")
        trip_text = "הלוך-חזור" if len(combo) > 1 else "כיוון אחד"
        return {
            "supplier_offer_id": supplier_id(self.supplier_prefix, self.provider_id, combo_key, brand.code, cabin, pax),
            "sort_total": str(total),
            "title": f"{o_city.name_he} – {d_city.name_he}",
            "subtitle": f"{carrier.name_he} · {trip_text} · {stops_text} · {brand.name}",
            "details": {
                "kind": "flight",
                "slices": [_slice_dict(it, cabin) for it in combo],
                "cabin": cabin,
                "fare_brand": brand.name,
                "baggage": _baggage(brand, pax["infant"] > 0),
                "passengers": dict(pax),
                "validating_carrier": carrier.code,
                "total_duration_minutes": sum(it.duration_minutes for it in combo),
                "max_stops": max_stops,
            },
            "price": {"currency": cur, "components": components, "excluded_notes": excluded_notes,
                      "persons": sum(pax.values())},
            "cancellation": cancellation,
            "warnings": warnings,
        }


class DemoSkylineAdapter(DemoFlightAdapter):
    provider_id = "demo_skyline"
    display_name = "דמו סקייליין"
    supplier_prefix = "SKY"
    description = "סוכן טיסות בדיוני: מוכר את כל משפחות התעריפים של ארבע חברות תעופה בדיוניות."
    carriers = frozenset({"D1", "D2", "D3", "D4"})
    markup_range = (-0.025, 0.03)


class DemoAuroraAdapter(DemoFlightAdapter):
    provider_id = "demo_aurora"
    display_name = "דמו אורורה"
    supplier_prefix = "AUR"
    description = "סוכן טיסות בדיוני: ללא תעריפי 'לייט', גובה דמי שירות לנוסע."
    carriers = frozenset({"D1", "D2", "D3", "D5"})
    excluded_brands = frozenset({"ECO_LIGHT"})
    markup_range = (-0.035, 0.02)
    service_fee_usd = Decimal("7")
