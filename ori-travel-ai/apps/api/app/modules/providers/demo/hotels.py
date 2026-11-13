"""DEMO hotel adapters: "דמו סטיי-פלוס" (demo_stayplus) and "דמו הוטליה" (demo_hotelia).

Real cities/coordinates; FICTIONAL hotels from fictional chains (e.g.
"מלונות מוזאיקה (דמו)"). Both providers resell a shared deterministic hotel
market per city, so the same hotel + room + board + cancellation terms appear
at both with slightly different prices (merged by dedupe), while rate plans
that differ (board, refundability, room) stay separate.

City tax is listed as an EXCLUDED, estimated component paid at the hotel.
``kosher_info`` is set only as an explicit fixture fact of specific hotels.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any, ClassVar

from app.modules.providers.base import ProviderUnsupportedError
from app.modules.providers.data.geo import CITIES, City, city_zone, haversine_km, offset_point, resolve_city
from app.modules.providers.demo.common import (
    DemoAdapter,
    dec,
    round_dec,
    season_factor,
    seeded_rng,
    supplier_id,
    unit,
    usd,
)
from app.schemas.common import ApiModel, Category
from app.schemas.search import HotelSearchParams


@dataclass(frozen=True)
class Chain:
    short: str
    brand: str
    style: str  # city | resort | budget | apartments
    stars: tuple[int, int]
    kosher_capable: bool = False


CHAINS: tuple[Chain, ...] = (
    Chain("מוזאיקה", "מלונות מוזאיקה (דמו)", "city", (3, 4), kosher_capable=True),
    Chain("אורנים סוויטס", "אורנים סוויטס (דמו)", "apartments", (3, 4)),
    Chain("בית הים", "בית הים (דמו)", "resort", (4, 5), kosher_capable=True),
    Chain("גרנד ליבנה", "גרנד ליבנה (דמו)", "city", (4, 5), kosher_capable=True),
    Chain("סיטי-נסט", "סיטי-נסט (דמו)", "budget", (2, 3)),
    Chain("פנינת החוף", "פנינת החוף (דמו)", "resort", (3, 5)),
    Chain("אכסניית הדרך", "אכסניית הדרך (דמו)", "budget", (2, 3)),
    Chain("טרקלין", "מלונות טרקלין (דמו)", "city", (4, 5)),
)
VARIANTS = ("סנטרו", "פארק", "סיטי", "גארדן", "פלאזה", "רזידנס", "ויו", "בוטיק")


@dataclass(frozen=True)
class RoomType:
    code: str
    name: str
    max_adults: int
    max_total: int
    factor: Decimal


ROOM_TYPES: dict[str, RoomType] = {
    "STD_DBL": RoomType("STD_DBL", "חדר זוגי סטנדרט", 2, 3, Decimal("1.0")),
    "FAMILY": RoomType("FAMILY", "חדר משפחתי", 3, 4, Decimal("1.35")),
    "FAMILY_SUITE": RoomType("FAMILY_SUITE", "סוויטה משפחתית", 4, 5, Decimal("1.75")),
    "APT_2BR": RoomType("APT_2BR", "דירת שני חדרי שינה", 4, 6, Decimal("1.95")),
}
ROOMS_BY_STYLE = {
    "city": ("STD_DBL", "FAMILY", "FAMILY_SUITE"),
    "resort": ("STD_DBL", "FAMILY", "FAMILY_SUITE"),
    "budget": ("STD_DBL", "FAMILY"),
    "apartments": ("STD_DBL", "FAMILY", "APT_2BR"),
}
BOARDS_BY_STYLE = {
    "city": ("room_only", "breakfast"),
    "resort": ("breakfast", "half_board", "all_inclusive"),
    "budget": ("room_only", "breakfast"),
    "apartments": ("room_only",),
}
BOARD_HE = {
    "room_only": "לינה בלבד",
    "breakfast": "ארוחת בוקר",
    "half_board": "חצי פנסיון",
    "full_board": "פנסיון מלא",
    "all_inclusive": "הכול כלול",
}
BOARD_USD_PER_PERSON = {"room_only": Decimal(0), "breakfast": Decimal(14), "half_board": Decimal(32),
                        "full_board": Decimal(48), "all_inclusive": Decimal(68)}
STARS_FACTOR = {2: Decimal("0.6"), 3: Decimal("1.0"), 4: Decimal("1.5"), 5: Decimal("2.5")}
AMENITIES = ("Wi-Fi חינם", "מיזוג אוויר", "בריכה", "חניה", "חדר כושר", "מטבחון", "מיטת תינוק לבקשה",
             "מועדון ילדים", "קרוב לתחבורה ציבורית", "מכונת כביסה")
ACCESSIBILITY = ("חדרים נגישים לכיסאות גלגלים", "מעלית", "מקלחת ללא מדרגה")
KOSHER_FIXTURE = "ארוחת בוקר כשרה בהשגחה מקומית (נתון הדגמה — יש לאמת מול המלון)"

# City tax estimates (local currency per adult per night; per room for "room").
# Illustrative DEMO values only — paid at the hotel, never included in the total.
CITY_TAX: dict[str, tuple[str, Decimal, str]] = {
    "ROM": ("EUR", Decimal("6"), "person"), "MIL": ("EUR", Decimal("5"), "person"), "VCE": ("EUR", Decimal("4"), "person"),
    "NAP": ("EUR", Decimal("4"), "person"), "PAR": ("EUR", Decimal("3.5"), "person"), "NCE": ("EUR", Decimal("2.5"), "person"),
    "BCN": ("EUR", Decimal("5"), "person"), "PMI": ("EUR", Decimal("3"), "person"), "LIS": ("EUR", Decimal("4"), "person"),
    "AMS": ("EUR", Decimal("12"), "person"), "BER": ("EUR", Decimal("4"), "person"), "FRA": ("EUR", Decimal("2"), "person"),
    "VIE": ("EUR", Decimal("3"), "person"), "PRG": ("CZK", Decimal("50"), "person"), "BUD": ("HUF", Decimal("1500"), "person"),
    "ATH": ("EUR", Decimal("4"), "room"), "SKG": ("EUR", Decimal("3"), "room"), "HER": ("EUR", Decimal("3"), "room"),
    "RHO": ("EUR", Decimal("3"), "room"), "CFU": ("EUR", Decimal("3"), "room"), "ZRH": ("CHF", Decimal("2.5"), "person"),
    "KRK": ("PLN", Decimal("3"), "person"), "MLA": ("EUR", Decimal("0.5"), "person"), "DXB": ("AED", Decimal("15"), "room"),
    "TYO": ("JPY", Decimal("200"), "person"), "SOF": ("EUR", Decimal("1"), "person"), "BUH": ("RON", Decimal("10"), "person"),
}


@dataclass(frozen=True)
class Hotel:
    market_id: str
    name: str
    chain: Chain
    stars: int
    guest_rating: float
    review_count: int
    distance_km: float
    lat: float
    lon: float
    area: str
    boards: tuple[str, ...]
    room_types: tuple[str, ...]
    amenities: tuple[str, ...]
    accessibility: tuple[str, ...]
    kosher_info: str | None
    free_cancel_days: int
    price_factor: Decimal


@lru_cache(maxsize=128)
def hotel_market(city_code: str) -> tuple[Hotel, ...]:
    """Deterministic hotel inventory for a city (seeded by the city code only)."""
    city = CITIES[city_code]
    rng = seeded_rng("hotel-market", city.code)
    chains = [c for c in CHAINS if c.style != "resort" or city.coastal]
    count = 9 + rng.randrange(0, 4)
    hotels: list[Hotel] = []
    used: set[str] = set()
    for i in range(count):
        chain = chains[rng.randrange(len(chains))]
        variant = VARIANTS[rng.randrange(len(VARIANTS))]
        name = f"{chain.short} {city.name_he.split(' (')[0]} {variant} (דמו)"
        if name in used:
            name = f"{chain.short} {city.name_he.split(' (')[0]} {variant} {i + 1} (דמו)"
        used.add(name)
        stars = rng.randint(*chain.stars)
        rating = round(min(9.7, max(6.4, rng.uniform(6.6, 9.0) + (stars - 3) * 0.25)), 1)
        central = rng.random() < 0.55
        distance = round(rng.uniform(0.2, 1.6) if central else rng.uniform(1.6, 7.5), 1)
        if chain.style == "resort":
            distance = round(rng.uniform(2.0, 9.0), 1)
        lat, lon = offset_point(city.lat, city.lon, distance, rng.uniform(0, 360))
        area = ("ליד החוף" if chain.style == "resort" else
                "מרכז העיר" if distance < 1.2 else "העיר העתיקה" if distance < 2.5 else "רובע מגורים שקט")
        amenities = tuple(sorted(rng.sample(AMENITIES, 4) + (["מועדון ילדים", "בריכה"] if chain.style == "resort" else [])))
        accessibility = ACCESSIBILITY[: rng.randint(1, 3)] if rng.random() < 0.55 else ()
        kosher = KOSHER_FIXTURE if chain.kosher_capable and rng.random() < 0.25 else None
        boards = BOARDS_BY_STYLE[chain.style]
        if chain.style == "resort" and rng.random() < 0.4:
            boards = ("breakfast", "half_board", "full_board", "all_inclusive")
        hotels.append(
            Hotel(
                market_id=f"{city.code}-{i + 1:02d}",
                name=name,
                chain=chain,
                stars=stars,
                guest_rating=rating,
                review_count=rng.randint(40, 3200),
                distance_km=distance,
                lat=lat,
                lon=lon,
                area=area,
                boards=boards,
                room_types=ROOMS_BY_STYLE[chain.style],
                amenities=tuple(dict.fromkeys(amenities)),
                accessibility=tuple(accessibility),
                kosher_info=kosher,
                free_cancel_days=rng.choice((1, 2, 3, 7)),
                price_factor=round_dec(dec(rng.uniform(0.85, 1.2))),
            )
        )
    return tuple(hotels)


def _fit(room_types: tuple[str, ...], adults: int, total: int) -> list[RoomType]:
    return sorted(
        (ROOM_TYPES[c] for c in room_types if adults <= ROOM_TYPES[c].max_adults and total <= ROOM_TYPES[c].max_total),
        key=lambda r: r.factor,
    )


def _room_plans(hotel: Hotel, params: HotelSearchParams) -> list[list[RoomType]]:
    """Minimal fitting room per requested room, plus one upgrade plan when available."""
    fits = [_fit(hotel.room_types, r.adults, r.adults + len(r.children_ages)) for r in params.rooms]
    if any(not f for f in fits):
        return []
    plans = [[f[0] for f in fits]]
    if all(len(f) > 1 for f in fits):
        plans.append([f[1] for f in fits])
    return plans


def _room_name(plan: list[RoomType]) -> str:
    names = [r.name for r in plan]
    if len(set(names)) == 1:
        return names[0] if len(names) == 1 else f"{len(names)} × {names[0]}"
    return " + ".join(names)


class DemoHotelAdapter(DemoAdapter):
    categories: ClassVar[tuple[Category, ...]] = ("hotel",)
    default_max_results = 30
    sell_threshold: ClassVar[tuple[float, float]] = (0.0, 1.0)  # sells hotels whose unit() falls in range
    markup_range: ClassVar[tuple[float, float]] = (0.0, 0.0)

    def rate_plans(self, hotel: Hotel, plan_index: int) -> list[tuple[str, bool]]:  # pragma: no cover - abstract
        raise NotImplementedError

    def generate(self, category: Category, params: ApiModel) -> list[dict[str, Any]]:
        assert isinstance(params, HotelSearchParams)
        city = resolve_city(params.destination)
        if city is None:
            raise ProviderUnsupportedError("היעד אינו נתמך בנתוני ההדגמה", code="UNSUPPORTED_LOCATION")
        payloads: list[dict[str, Any]] = []
        lo, hi = self.sell_threshold
        for hotel in hotel_market(city.code):
            if not lo <= unit("hotel-sells", hotel.market_id) < hi:
                continue
            for plan_index, plan in enumerate(_room_plans(hotel, params)):
                for board, refundable in self.rate_plans(hotel, plan_index):
                    payloads.append(self._build(params, city, hotel, plan, board, refundable))
        return payloads

    def _build(self, params: HotelSearchParams, city: City, hotel: Hotel, plan: list[RoomType], board: str,
               refundable: bool) -> dict[str, Any]:
        cur = params.currency
        nights = params.nights
        lo, hi = self.markup_range
        rate_key = f"{hotel.market_id}|{'+'.join(r.code for r in plan)}|{board}|{int(refundable)}"
        markup = round_dec(Decimal(1) + dec(lo + (hi - lo) * unit(self.provider_id, rate_key, params.check_in.isoformat())))

        room_usd = Decimal(0)
        board_usd = Decimal(0)
        adults = sum(r.adults for r in params.rooms)
        children = sum(len(r.children_ages) for r in params.rooms)
        board_scale = Decimal("0.8") if hotel.stars <= 3 else (Decimal("1.0") if hotel.stars == 4 else Decimal("1.4"))
        for n in range(nights):
            night = params.check_in + timedelta(days=n)
            night_factor = season_factor(night) * (Decimal("1.12") if night.weekday() in (4, 5) else Decimal(1))
            for room, occ in zip(plan, params.rooms, strict=True):
                occ_factor = Decimal(1) + Decimal("0.2") * max(0, occ.adults - 2) + Decimal("0.08") * sum(
                    1 for a in occ.children_ages if a >= 2
                )
                room_usd += (dec(city.cost_index) * STARS_FACTOR[hotel.stars] * room.factor * night_factor
                             * hotel.price_factor * occ_factor)
                eaters = occ.adults + Decimal("0.5") * sum(1 for a in occ.children_ages if a >= 2)
                board_usd += BOARD_USD_PER_PERSON[board] * board_scale * eaters
        if not refundable:
            room_usd *= Decimal("0.9")
        room_usd *= markup
        board_usd *= markup
        components: list[dict[str, Any]] = [
            {"label": f"מחיר החדרים ל-{nights} לילות", "kind": "base", "amount": usd(room_usd, cur)},
        ]
        if board != "room_only":
            components.append({"label": f"תוספת {BOARD_HE[board]}", "kind": "extra", "amount": usd(board_usd, cur)})
        components.append({"label": "מיסים ודמי שירות", "kind": "tax", "amount": usd((room_usd + board_usd) * Decimal("0.1"), cur)})
        excluded_notes: list[str] = []
        tax = CITY_TAX.get(city.code)
        if tax:
            tax_cur, rate, basis = tax
            units = (adults if basis == "person" else len(params.rooms)) * nights
            amount = rate * units
            basis_he = "לאדם ללילה" if basis == "person" else "לחדר ללילה"
            components.append(
                {"label": "מס עירוני (משולם במלון)", "kind": "tax", "amount": amount, "currency": tax_cur,
                 "status": "excluded", "included": False}
            )
            excluded_notes.append(f"מס עירוני משולם במלון — הערכה: כ-{rate} {tax_cur} {basis_he}, אינו כלול במחיר")
        total = sum((c["amount"] for c in components if c.get("included", True)), Decimal(0))

        tz = city_zone(city)
        if refundable:
            deadline = datetime.combine(params.check_in - timedelta(days=hotel.free_cancel_days), time(23, 59), tzinfo=tz)
            cancellation = {
                "refundable": True,
                "free_cancellation_until": deadline,
                "changeable": True,
                "change_fee": None,
                "policy_text": (
                    f"ביטול חינם עד {deadline:%d/%m/%Y} 23:59 (שעון מקומי); לאחר מכן חיוב בעלות הלילה הראשון (תנאי הדגמה)"
                ),
            }
        else:
            cancellation = {"refundable": False, "free_cancellation_until": None, "changeable": False,
                            "change_fee": None, "policy_text": "תעריף מוזל שאינו ניתן לביטול או לשינוי (תנאי הדגמה)"}

        warnings: list[str] = []
        if params.kosher_preference and not hotel.kosher_info:
            warnings.append("לא נמסר מידע על כשרות — יש לבדוק מול המלון")
        room_name = _room_name(plan)
        cancel_text = "ביטול חינם" if refundable else "ללא ביטול"
        return {
            "supplier_offer_id": supplier_id(self.supplier_prefix, self.provider_id, rate_key, params.check_in,
                                             params.check_out, [r.model_dump() for r in params.rooms]),
            "title": hotel.name,
            "subtitle": f"{hotel.stars}★ · {room_name} · {BOARD_HE[board]} · {cancel_text}",
            "details": {
                "kind": "hotel",
                "hotel_name": hotel.name,
                "hotel_id": f"{self.supplier_prefix}-{hotel.market_id}",
                "star_rating": float(hotel.stars),
                "guest_rating": hotel.guest_rating,
                "review_count": hotel.review_count,
                "address": f"{city.name_he}, {city.country_he} — {hotel.area} (כתובת להדגמה)",
                "city": city.name_he,
                "country_code": city.country_code,
                "latitude": hotel.lat,
                "longitude": hotel.lon,
                "distance_to_center_km": round(haversine_km(city.lat, city.lon, hotel.lat, hotel.lon), 1),
                "room_name": room_name,
                "board": board,
                "check_in": params.check_in,
                "check_out": params.check_out,
                "nights": nights,
                "rooms": len(params.rooms),
                "adults": adults,
                "children": children,
                "amenities": list(hotel.amenities),
                "kosher_info": hotel.kosher_info,
                "accessibility_features": list(hotel.accessibility),
            },
            "price": {"currency": cur, "components": components, "excluded_notes": excluded_notes, "nights": nights,
                      "persons": adults + children},
            "cancellation": cancellation,
            "warnings": warnings,
            "sort_total": str(total),
        }


class DemoStayPlusAdapter(DemoHotelAdapter):
    provider_id = "demo_stayplus"
    display_name = "דמו סטיי-פלוס"
    supplier_prefix = "STP"
    description = "סוכן מלונות בדיוני: תעריפים גמישים ומוזלים, כל סוגי הפנסיון."
    sell_threshold = (0.0, 0.72)
    markup_range = (-0.03, 0.03)

    def rate_plans(self, hotel: Hotel, plan_index: int) -> list[tuple[str, bool]]:
        if plan_index == 0:
            plans = [(hotel.boards[0], True), (hotel.boards[0], False)]
            if len(hotel.boards) > 1:
                plans.append((hotel.boards[1], True))
            return plans
        return [(hotel.boards[0], True)]


class DemoHoteliaAdapter(DemoHotelAdapter):
    provider_id = "demo_hotelia"
    display_name = "דמו הוטליה"
    supplier_prefix = "HTL"
    description = "סוכן מלונות בדיוני: מתמחה בתעריפים עם ביטול חינם ובחבילות פנסיון."
    sell_threshold = (0.3, 1.0)
    markup_range = (-0.04, 0.025)

    def rate_plans(self, hotel: Hotel, plan_index: int) -> list[tuple[str, bool]]:
        if plan_index == 0:
            plans = [(b, True) for b in hotel.boards[:3]]
            return plans
        return [(hotel.boards[-1], True)]
