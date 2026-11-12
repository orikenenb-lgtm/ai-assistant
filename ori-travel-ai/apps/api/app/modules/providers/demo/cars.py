"""DEMO car-rental adapters: "דמו דרייב" (demo_drive) and "דמו רנטוויי" (demo_rentway).

Real airports/cities; FICTIONAL rental vendors ("רנט-אור (דמו)" ...). Both
brokers resell a shared deterministic fleet per pickup location, so the same
vendor + car + location + times + insurance + mileage appears at both with
slightly different prices (merged by dedupe).

Young-driver fee (driver_age < 25) is handled EXPLICITLY and differently:
* demo_drive: KNOWN fee, included in the total.
* demo_rentway: ESTIMATED fee payable at the counter, NOT included in the total
  (listed as an excluded/estimated component + warning). Because what the total
  covers differs, such offers are intentionally not merged with demo_drive's.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, tzinfo
from decimal import Decimal
from functools import lru_cache
from typing import Any, ClassVar

from app.modules.providers.base import ProviderUnsupportedError
from app.modules.providers.data.geo import AIRPORTS, CITIES, Airport, City, city_zone, resolve_airport, resolve_city
from app.modules.providers.demo.common import DemoAdapter, dec, round_dec, season_factor, seeded_rng, supplier_id, unit, usd
from app.schemas.common import ApiModel, Category
from app.schemas.search import CarSearchParams


@dataclass(frozen=True)
class Vendor:
    code: str
    name: str
    counter: str  # terminal | shuttle
    factor: Decimal
    mileage: str  # "unlimited" | "200km/day"
    min_age: int
    classes: tuple[str, ...]


@dataclass(frozen=True)
class CarClass:
    key: str
    car_class: str  # canonical class
    model: str
    seats: int
    bags: int
    usd_per_day: Decimal
    deposit_usd: Decimal


VENDORS: dict[str, Vendor] = {
    "V1": Vendor("V1", "רנט-אור (דמו)", "terminal", Decimal("1.05"), "unlimited", 21,
                 ("mini", "economy", "compact", "midsize", "fullsize", "suv", "van7", "premium")),
    "V2": Vendor("V2", "קאר-פוינט (דמו)", "shuttle", Decimal("0.92"), "unlimited", 21,
                 ("mini", "economy", "compact", "midsize", "suv", "van7")),
    "V3": Vendor("V3", "גלגלים פלוס (דמו)", "terminal", Decimal("1.15"), "unlimited", 23,
                 ("compact", "midsize", "fullsize", "suv", "van7", "van9", "premium")),
    "V4": Vendor("V4", "סיטי-דרייב (דמו)", "shuttle", Decimal("0.85"), "200km/day", 21,
                 ("mini", "economy", "compact", "midsize", "van7")),
}

CLASSES: dict[str, CarClass] = {
    "mini": CarClass("mini", "mini", "Fiat 500 או דומה", 4, 1, Decimal(28), Decimal(250)),
    "economy": CarClass("economy", "economy", "Volkswagen Polo או דומה", 5, 2, Decimal(32), Decimal(300)),
    "compact": CarClass("compact", "compact", "Volkswagen Golf או דומה", 5, 3, Decimal(38), Decimal(350)),
    "midsize": CarClass("midsize", "midsize", "Toyota Corolla Touring או דומה", 5, 3, Decimal(46), Decimal(400)),
    "fullsize": CarClass("fullsize", "fullsize", "Skoda Superb או דומה", 5, 4, Decimal(58), Decimal(500)),
    "suv": CarClass("suv", "suv", "Nissan Qashqai או דומה", 5, 3, Decimal(62), Decimal(550)),
    "van7": CarClass("van7", "van", "Volkswagen Touran או דומה", 7, 2, Decimal(76), Decimal(600)),
    "van9": CarClass("van9", "van", "Ford Tourneo Custom או דומה", 9, 4, Decimal(98), Decimal(700)),
    "premium": CarClass("premium", "premium", "BMW 5 Series או דומה", 5, 4, Decimal(115), Decimal(1000)),
}
CLASS_HE = {"mini": "מיני", "economy": "חסכוני", "compact": "קומפקטי", "midsize": "בינוני", "fullsize": "גדול",
            "suv": "רכב פנאי (SUV)", "van": "רב-מקומות", "premium": "יוקרה"}
REGION_INDEX = {"israel": Decimal("1.1"), "europe_west": Decimal("1.0"), "europe_south": Decimal("0.9"),
                "europe_east": Decimal("0.75"), "switzerland": Decimal("1.4"), "caucasus": Decimal("0.7"),
                "middle_east": Decimal("0.85"), "gulf": Decimal("0.95"), "asia_se": Decimal("0.7"),
                "japan": Decimal("1.2"), "north_america": Decimal("1.25")}
AUTOMATIC_ONLY_REGIONS = {"israel", "gulf", "north_america", "japan", "asia_se"}
BASIC_INSURANCE = ("ביטוח נזקי רכב (CDW) עם השתתפות עצמית", "ביטוח גניבה (TP) עם השתתפות עצמית", "ביטוח צד ג' (חובה)")
FULL_INSURANCE = ("ביטוח נזקי רכב (CDW) ללא השתתפות עצמית", "ביטוח גניבה (TP) ללא השתתפות עצמית", "ביטוח צד ג' (חובה)",
                  "כיסוי שמשות וצמיגים")
YOUNG_DRIVER_USD_PER_DAY = Decimal(14)
YOUNG_DRIVER_USD_CAP = Decimal(180)
FULL_COVER_USD_PER_DAY = Decimal(16)
FREE_CANCEL_HOURS = 48


@dataclass(frozen=True)
class Location:
    key: str
    city: City
    airport: Airport | None

    def label(self, counter: str) -> str:
        if self.airport is None:
            return f"{self.city.name_he} — סניף מרכז העיר"
        suffix = "דלפק בטרמינל" if counter == "terminal" else "שאטל לחניון ההשכרה"
        return f"{self.airport.name_he} ({self.airport.iata}) — {suffix}"


def resolve_location(text: str) -> Location | None:
    raw = text.strip()
    if len(raw) == 3 and raw.isascii() and raw.isalpha() and raw.upper() in AIRPORTS:
        ap = AIRPORTS[raw.upper()]
        return Location(ap.iata, CITIES[ap.city_code], ap)
    city = resolve_city(raw)
    if city is None:
        ap = resolve_airport(raw)
        return Location(ap.iata, CITIES[ap.city_code], ap) if ap else None
    return Location(f"city:{city.code}", city, None)


@dataclass(frozen=True)
class FleetItem:
    vendor: str
    car: str
    transmission: str
    factor: Decimal


@lru_cache(maxsize=256)
def fleet(location_key: str, region: str) -> tuple[FleetItem, ...]:
    """Deterministic fleet at a pickup location (seeded by the location only)."""
    rng = seeded_rng("car-market", location_key)
    items: list[FleetItem] = []
    for code in sorted(VENDORS):
        vendor = VENDORS[code]
        if code != "V1" and rng.random() >= 0.85:
            continue
        for car in vendor.classes:
            if rng.random() >= 0.8:
                continue
            factor = round_dec(dec(rng.uniform(0.9, 1.1)))
            if region in AUTOMATIC_ONLY_REGIONS or car in ("fullsize", "premium", "van9"):
                items.append(FleetItem(code, car, "automatic", factor))
            else:
                items.append(FleetItem(code, car, "manual", factor))
                if rng.random() < 0.7:
                    items.append(FleetItem(code, car, "automatic", round_dec(factor * Decimal("1.2"))))
    return tuple(items)


def _localize(dt: datetime, tz: tzinfo) -> datetime:
    return dt.replace(tzinfo=tz) if dt.tzinfo is None else dt.astimezone(tz)


def rental_days(pickup: datetime, dropoff: datetime) -> int:
    minutes = (dropoff - pickup).total_seconds() / 60
    return max(1, math.ceil((minutes - 29) / 1440))  # 29-minute grace period


class DemoCarAdapter(DemoAdapter):
    categories: ClassVar[tuple[Category, ...]] = ("car",)
    default_max_results = 30
    vendors: ClassVar[frozenset[str]] = frozenset()
    markup_range: ClassVar[tuple[float, float]] = (0.0, 0.0)
    young_driver_fee_known: ClassVar[bool] = True
    full_cover_vendors: ClassVar[frozenset[str]] = frozenset()
    prepaid_vendors: ClassVar[frozenset[str]] = frozenset()

    def generate(self, category: Category, params: ApiModel) -> list[dict[str, Any]]:
        assert isinstance(params, CarSearchParams)
        pickup = resolve_location(params.pickup_location)
        dropoff = resolve_location(params.dropoff_location) if params.dropoff_location else pickup
        if pickup is None or dropoff is None:
            raise ProviderUnsupportedError("מיקום האיסוף או ההחזרה אינו נתמך בנתוני ההדגמה", code="UNSUPPORTED_LOCATION")
        if dropoff.city.country_code != pickup.city.country_code:
            # DEMO vendors do not offer cross-border one-way rentals
            return []
        pickup_at = _localize(params.pickup_at, city_zone(pickup.city))
        dropoff_at = _localize(params.dropoff_at, city_zone(dropoff.city))
        days = rental_days(pickup_at, dropoff_at)
        payloads: list[dict[str, Any]] = []
        for item in fleet(pickup.key, pickup.city.region):
            if item.vendor not in self.vendors:
                continue
            vendor = VENDORS[item.vendor]
            car = CLASSES[item.car]
            min_age = max(vendor.min_age, 25 if item.car == "premium" else 0)
            if params.driver_age < min_age:
                continue
            packages = ["basic"] + (["full"] if item.vendor in self.full_cover_vendors else [])
            for package in packages:
                payloads.append(
                    self._build(params, pickup, dropoff, pickup_at, dropoff_at, days, item, vendor, car, min_age, package)
                )
        payloads.sort(key=lambda p: (Decimal(p["sort_total"]), p["supplier_offer_id"]))
        return payloads

    def _build(self, params: CarSearchParams, pickup: Location, dropoff: Location, pickup_at: datetime,
               dropoff_at: datetime, days: int, item: FleetItem, vendor: Vendor, car: CarClass, min_age: int,
               package: str) -> dict[str, Any]:
        cur = params.currency
        lo, hi = self.markup_range
        product_key = f"{pickup.key}|{dropoff.key}|{item.vendor}|{item.car}|{item.transmission}|{package}"
        markup = round_dec(Decimal(1) + dec(lo + (hi - lo) * unit(self.provider_id, product_key, pickup_at.isoformat())))
        long_discount = Decimal("0.78") if days >= 14 else Decimal("0.85") if days >= 7 else Decimal(1)
        daily = (car.usd_per_day * REGION_INDEX.get(pickup.city.region, Decimal(1)) * season_factor(pickup_at.date())
                 * vendor.factor * item.factor * long_discount)
        prepaid = item.vendor in self.prepaid_vendors
        if prepaid:
            daily *= Decimal("0.92")
        base_usd = daily * days * markup
        tax_rate = Decimal("0.18") if pickup.airport else Decimal("0.12")
        components: list[dict[str, Any]] = [
            {"label": f"השכרה ל-{days} ימים", "kind": "base", "amount": usd(base_usd, cur)},
            {"label": "מיסים ודמי מיקום" if pickup.airport is None else "מיסים ודמי שדה תעופה", "kind": "tax",
             "amount": usd(base_usd * tax_rate, cur)},
        ]
        if dropoff.key != pickup.key:
            one_way = Decimal(60) + Decimal(60) * dec(unit("one-way", pickup.key, dropoff.key))
            components.append({"label": "דמי החזרה במיקום אחר", "kind": "fee", "amount": usd(one_way, cur)})
        if package == "full":
            components.append({"label": "שדרוג לכיסוי מלא ללא השתתפות עצמית", "kind": "extra",
                               "amount": usd(FULL_COVER_USD_PER_DAY * days, cur)})
        warnings: list[str] = []
        excluded_notes: list[str] = []
        young = params.driver_age < 25
        if young:
            fee = usd(min(YOUNG_DRIVER_USD_PER_DAY * days, YOUNG_DRIVER_USD_CAP), cur)
            if self.young_driver_fee_known:
                components.append({"label": "דמי נהג צעיר (מתחת לגיל 25)", "kind": "fee", "amount": fee})
            else:
                components.append({"label": "דמי נהג צעיר — משולמים בדלפק (הערכה)", "kind": "fee", "amount": fee,
                                   "status": "estimated", "included": False})
                note = "דמי נהג צעיר אינם כלולים במחיר ומשולמים בדלפק — הסכום הוא הערכה"
                excluded_notes.append(note)
                warnings.append(note)
        if vendor.mileage != "unlimited":
            excluded_notes.append("מעבר ל-200 ק\"מ ליום יחויב בדלפק לפי ק\"מ")
        total = sum((c["amount"] for c in components if c.get("included", True)), Decimal(0))

        if prepaid:
            cancellation = {"refundable": False, "free_cancellation_until": None, "changeable": False,
                            "change_fee": None, "policy_text": "תשלום מראש — ללא ביטול וללא שינוי (תנאי הדגמה)"}
        else:
            deadline = pickup_at - timedelta(hours=FREE_CANCEL_HOURS)
            cancellation = {"refundable": True, "free_cancellation_until": deadline, "changeable": True,
                            "change_fee": None,
                            "policy_text": f"ביטול חינם עד {FREE_CANCEL_HOURS} שעות לפני האיסוף; תשלום בעת האיסוף (תנאי הדגמה)"}
        insurance = FULL_INSURANCE if package == "full" else BASIC_INSURANCE
        deposit = usd(Decimal(100) if package == "full" else car.deposit_usd, cur)
        transmission_he = "אוטומטית" if item.transmission == "automatic" else "ידנית"
        pickup_label = pickup.label(vendor.counter)
        dropoff_label = dropoff.label(vendor.counter)
        return {
            "supplier_offer_id": supplier_id(self.supplier_prefix, self.provider_id, product_key, pickup_at, dropoff_at,
                                             params.driver_age),
            "sort_total": str(total),
            "title": f"{car.model} · {vendor.name}",
            "subtitle": f"{CLASS_HE[car.car_class]} · {transmission_he} · {car.seats} מושבים · {pickup.city.name_he}",
            "details": {
                "kind": "car",
                "vendor": vendor.name,
                "car_class": car.car_class,
                "model_example": car.model,
                "transmission": item.transmission,
                "seats": car.seats,
                "bags": car.bags,
                "air_conditioning": True,
                "fuel_policy": "מלא-מלא",
                "mileage": vendor.mileage,
                "pickup_location": pickup_label,
                "dropoff_location": dropoff_label,
                "pickup_at": pickup_at,
                "dropoff_at": dropoff_at,
                "rental_days": days,
                "driver_min_age": min_age,
                "young_driver_fee_applies": young,
                "insurance_included": list(insurance),
                "deposit": {"amount": deposit, "currency": cur},
            },
            "price": {"currency": cur, "components": components, "excluded_notes": excluded_notes, "days": days},
            "cancellation": cancellation,
            "warnings": warnings,
        }


class DemoDriveAdapter(DemoCarAdapter):
    provider_id = "demo_drive"
    display_name = "דמו דרייב"
    supplier_prefix = "DRV"
    description = "מתווך השכרת רכב בדיוני: ביטוח בסיסי, דמי נהג צעיר ידועים וכלולים במחיר."
    vendors = frozenset({"V1", "V2", "V3"})
    markup_range = (-0.03, 0.03)
    young_driver_fee_known = True


class DemoRentwayAdapter(DemoCarAdapter):
    provider_id = "demo_rentway"
    display_name = "דמו רנטוויי"
    supplier_prefix = "RNW"
    description = "מתווך השכרת רכב בדיוני: כולל חבילות כיסוי מלא; דמי נהג צעיר משולמים בדלפק (הערכה)."
    vendors = frozenset({"V1", "V2", "V4"})
    markup_range = (-0.04, 0.02)
    young_driver_fee_known = False
    full_cover_vendors = frozenset({"V1"})
    prepaid_vendors = frozenset({"V4"})
