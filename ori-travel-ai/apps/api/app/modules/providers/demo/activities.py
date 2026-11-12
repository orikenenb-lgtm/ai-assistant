"""DEMO activity adapters: "דמו פאן-טריפ" (demo_funtrip) and "דמו קידוונצ'רס" (demo_kidventures).

Real cities and landmarks; FICTIONAL operators (suffixed "(דמו)") and prices.
Both resell a shared deterministic catalog per city; family-friendly products
are sold by both (slightly different prices + a booking fee at Kidventures)
and are merged by dedupe.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any, ClassVar

from app.modules.providers.base import BookingOptions, ProviderCapabilities, ProviderUnsupportedError
from app.modules.providers.data.geo import CITIES, City, offset_point, resolve_city
from app.modules.providers.demo.common import DemoAdapter, dec, round_dec, seeded_rng, supplier_id, unit, usd
from app.schemas.common import ApiModel, Category
from app.schemas.offers import CanonicalOffer
from app.schemas.search import ActivitySearchParams

OPERATORS = ("מסעות ענבר (דמו)", "קידס-טורס (דמו)", "טעמים מקומיים (דמו)", "הרפתקאות כחול-ירוק (דמו)",
             "תרבות בדרכים (דמו)")
CATEGORY_HE = {"museum": "מוזיאון", "tour": "סיור", "outdoor": "טבע ופעילות בחוץ", "family": "משפחות",
               "food": "אוכל", "water": "מים ושיט", "nightlife": "חיי לילה", "shopping": "קניות",
               "culture": "תרבות", "adventure": "אתגרים"}


@dataclass(frozen=True)
class Template:
    name: str  # may contain {city}
    category: str
    minutes: int
    usd: Decimal
    child_ratio: Decimal
    min_age: int
    family: bool
    starts: tuple[str, ...]
    refundable: bool = True
    coastal_only: bool = False


GENERIC: tuple[Template, ...] = (
    Template("סיור הליכה משפחתי במרכז ההיסטורי של {city}", "tour", 150, Decimal(35), Decimal("0.5"), 0, True,
             ("09:30", "16:00")),
    Template("כרטיס כניסה למוזיאון ההיסטוריה המקומי של {city} + אודיו-גייד", "museum", 120, Decimal(22),
             Decimal("0.5"), 0, True, ("10:00", "13:00", "15:00")),
    Template("סדנת בישול וטעימות בשוק המקומי של {city}", "food", 180, Decimal(65), Decimal("0.6"), 6, True,
             ("10:00",)),
    Template("טיול אופניים מודרך בפארקים של {city}", "outdoor", 180, Decimal(45), Decimal("0.7"), 8, True,
             ("09:00", "15:00")),
    Template("שיט משפחתי לאורך החוף של {city}", "water", 120, Decimal(40), Decimal("0.6"), 0, True,
             ("11:00", "15:30"), coastal_only=True),
    Template("פארק מים ושעשועים ליד {city} — כרטיס יומי", "family", 480, Decimal(55), Decimal("0.8"), 0, True,
             ("10:00",), refundable=False),
    Template("מופע תרבות מקומי — ערב משפחתי ב{city}", "culture", 90, Decimal(40), Decimal("0.6"), 4, True,
             ("19:00",)),
    Template("פארק חבלים ואתגרים ליד {city}", "adventure", 180, Decimal(50), Decimal("0.8"), 7, True,
             ("10:00", "14:00")),
    Template("סיור ברים וחיי לילה ב{city}", "nightlife", 180, Decimal(40), Decimal("1"), 18, False, ("21:00",)),
    Template("סיור שווקים וקניות מקומיות ב{city}", "shopping", 180, Decimal(25), Decimal("0.5"), 0, True,
             ("10:30",)),
    Template("סיור פרטי בעברית עם מדריך מקומי ב{city}", "tour", 240, Decimal(90), Decimal("0.7"), 0, True,
             ("09:00", "14:00")),
)

# Real landmarks (real geography) offered by fictional DEMO operators.
_T, _D = Template, Decimal
LANDMARKS: dict[str, tuple[Template, ...]] = {
    "ROM": (_T("סיור משפחתי בקולוסיאום ובפורום הרומי", "tour", 180, _D(69), _D("0.6"), 0, True, ("09:00", "13:30")),
            _T("כרטיסים למוזיאוני הוותיקן ולקפלה הסיסטינית", "museum", 180, _D(45), _D("0.5"), 0, True, ("08:30", "11:00"))),
    "PAR": (_T("עלייה למגדל אייפל — קומה שנייה", "culture", 120, _D(38), _D("0.5"), 0, True, ("10:00", "17:00")),
            _T("מוזיאון הלובר — כניסה בשעה קבועה", "museum", 180, _D(25), _D("0"), 0, True, ("09:00", "14:00")),
            _T("דיסנילנד פריז — כרטיס יומי", "family", 600, _D(110), _D("0.9"), 0, True, ("09:30",), refundable=False)),
    "LON": (_T("מצודת לונדון ותכשיטי הכתר", "museum", 180, _D(40), _D("0.5"), 0, True, ("09:00", "13:00")),
            _T("שיט על נהר התמזה", "water", 60, _D(25), _D("0.5"), 0, True, ("11:00", "14:00", "16:00"))),
    "ATH": (_T("סיור באקרופוליס עם מדריך דובר עברית", "tour", 150, _D(50), _D("0.5"), 0, True, ("08:30", "17:00")),),
    "BCN": (_T("סגרדה פמיליה — כניסה עם אודיו-גייד", "culture", 90, _D(40), _D("0.6"), 0, True, ("09:00", "12:00", "15:00")),
            _T("פורט אוונטורה — כרטיס יומי", "family", 600, _D(70), _D("0.85"), 0, True, ("10:00",), refundable=False)),
    "AMS": (_T("שיט בתעלות אמסטרדם", "water", 75, _D(22), _D("0.5"), 0, True, ("10:00", "13:00", "16:00")),
            _T("מוזיאון המדע NEMO", "museum", 180, _D(22), _D("1"), 0, True, ("10:00",))),
    "PRG": (_T("סיור בטירת פראג ובגשר קארל", "tour", 180, _D(35), _D("0.5"), 0, True, ("09:30", "14:00")),),
    "BUD": (_T("שיט ערב על הדנובה", "water", 60, _D(25), _D("0.5"), 0, True, ("19:00", "20:30")),
            _T("מרחצאות סצ'ני — כניסה יומית", "water", 240, _D(40), _D("0.7"), 0, True, ("09:00",))),
    "DXB": (_T("עלייה לבורג' ח'ליפה — קומות 124-125", "tour", 90, _D(50), _D("0.75"), 0, True, ("10:00", "16:00", "18:00")),
            _T("ספארי מדבר משפחתי עם ארוחת ערב", "adventure", 360, _D(65), _D("0.7"), 3, True, ("15:00",))),
    "LCA": (_T("שיט בסירה שקופה למפרץ", "water", 120, _D(35), _D("0.5"), 0, True, ("10:00", "14:00")),),
    "TYO": (_T("טוקיו דיסנילנד — כרטיס יומי", "family", 600, _D(70), _D("0.75"), 0, True, ("09:00",), refundable=False),),
    "NYC": (_T("שייט לפסל החירות ולאי אליס", "tour", 180, _D(30), _D("0.6"), 0, True, ("09:00", "12:00")),
            _T("המוזיאון האמריקאי לתולדות הטבע", "museum", 180, _D(30), _D("0.6"), 0, True, ("10:00",))),
    "BKK": (_T("שוק צף ומקדשים — סיור יומי", "tour", 360, _D(45), _D("0.7"), 0, True, ("07:30",)),),
    "VIE": (_T("ארמון שנברון — סיור משפחתי", "museum", 120, _D(30), _D("0.6"), 0, True, ("09:00", "13:00")),),
}
LANGS = (("עברית", "אנגלית"), ("אנגלית",), ("אנגלית", "צרפתית"), ("עברית",), ("אנגלית", "ספרדית"))
LANG_CODES = {"he": "עברית", "en": "אנגלית", "fr": "צרפתית", "es": "ספרדית"}


@dataclass(frozen=True)
class Product:
    code: str
    name: str
    template: Template
    operator: str
    languages: tuple[str, ...]
    rating: float
    reviews: int
    accessibility: tuple[str, ...]
    weekdays: tuple[int, ...]
    lat: float
    lon: float
    price_factor: Decimal


@lru_cache(maxsize=128)
def catalog(city_code: str) -> tuple[Product, ...]:
    """Deterministic activity catalog for a city (seeded by the city code only)."""
    city = CITIES[city_code]
    rng = seeded_rng("activity-market", city.code)
    templates = [t for t in (*LANDMARKS.get(city.code, ()), *GENERIC) if city.coastal or not t.coastal_only]
    products: list[Product] = []
    for i, t in enumerate(templates):
        weekdays = tuple(sorted(rng.sample(range(7), rng.randint(4, 7))))
        lat, lon = offset_point(city.lat, city.lon, rng.uniform(0.1, 3.5), rng.uniform(0, 360))
        langs = ("עברית", "אנגלית") if "בעברית" in t.name or "דובר עברית" in t.name else LANGS[rng.randrange(len(LANGS))]
        access = ("נגיש לכיסאות גלגלים",) if t.category in ("museum", "culture", "water") and rng.random() < 0.6 else ()
        products.append(
            Product(
                code=f"{city.code}-{i + 1:02d}",
                name=t.name.format(city=city.name_he.split(" (")[0]),
                template=t,
                operator=OPERATORS[rng.randrange(len(OPERATORS))],
                languages=langs,
                rating=round(rng.uniform(3.9, 4.9), 1),
                reviews=rng.randint(8, 4200),
                accessibility=access,
                weekdays=weekdays,
                lat=lat,
                lon=lon,
                price_factor=round_dec(dec(rng.uniform(0.9, 1.15))),
            )
        )
    return tuple(products)


def _participants(params: ActivitySearchParams) -> dict[str, int]:
    """Attraction pricing: 12+ adult, 3-11 child, 0-2 free (infant)."""
    child = sum(1 for a in params.children_ages if 3 <= a <= 11)
    infant = sum(1 for a in params.children_ages if a < 3)
    teen = sum(1 for a in params.children_ages if a >= 12)
    return {"adult": params.adults + teen, "child": child, "infant": infant}


class DemoActivityAdapter(DemoAdapter):
    categories: ClassVar[tuple[Category, ...]] = ("activity",)
    default_max_results = 30
    family_only: ClassVar[bool] = False
    sell_threshold: ClassVar[float] = 1.0
    markup_range: ClassVar[tuple[float, float]] = (0.0, 0.0)
    booking_fee_usd_per_ticket: ClassVar[Decimal] = Decimal(0)

    def generate(self, category: Category, params: ApiModel) -> list[dict[str, Any]]:
        assert isinstance(params, ActivitySearchParams)
        city = resolve_city(params.destination)
        if city is None:
            raise ProviderUnsupportedError("היעד אינו נתמך בנתוני ההדגמה", code="UNSUPPORTED_LOCATION")
        days = [params.date_from + timedelta(days=i) for i in range((params.date_to - params.date_from).days + 1)]
        payloads: list[dict[str, Any]] = []
        for product in catalog(city.code):
            if self.family_only and not product.template.family:
                continue
            if unit("activity-sells", self.provider_id, product.code) >= self.sell_threshold:
                continue
            available = [d for d in days if d.weekday() in product.weekdays]
            if not available:
                continue
            payloads.append(self._build(params, city, product, available))
        return payloads

    def _build(self, params: ActivitySearchParams, city: City, product: Product, available: list[date]) -> dict[str, Any]:
        cur = params.currency
        t = product.template
        lo, hi = self.markup_range
        markup = round_dec(Decimal(1) + dec(lo + (hi - lo) * unit(self.provider_id, product.code, params.date_from.isoformat())))
        parts = _participants(params)
        adult_usd = t.usd * product.price_factor * markup
        child_usd = adult_usd * t.child_ratio
        components: list[dict[str, Any]] = [
            {"label": f"כרטיסי מבוגר ×{parts['adult']}", "kind": "base", "amount": usd(adult_usd * parts["adult"], cur)}
        ]
        if parts["child"] and child_usd > 0:
            components.append(
                {"label": f"כרטיסי ילד ×{parts['child']}", "kind": "base", "amount": usd(child_usd * parts["child"], cur)}
            )
        if self.booking_fee_usd_per_ticket:
            tickets = parts["adult"] + parts["child"]
            components.append({"label": "דמי הזמנה", "kind": "fee", "amount": usd(self.booking_fee_usd_per_ticket * tickets, cur)})
        warnings: list[str] = []
        if params.language:
            wanted = LANG_CODES.get(params.language.lower(), params.language)
            if wanted not in product.languages:
                warnings.append(f"הפעילות אינה מוצעת בשפה המבוקשת ({wanted})")
        if parts["infant"]:
            warnings.append("ילדים מתחת לגיל 3 נכנסים ללא תשלום (לפי תנאי ההדגמה)")
        if t.refundable:
            cancellation = {"refundable": True, "free_cancellation_until": None, "changeable": True, "change_fee": None,
                            "policy_text": "ביטול חינם עד 24 שעות לפני מועד הפעילות (תנאי הדגמה)"}
        else:
            cancellation = {"refundable": False, "free_cancellation_until": None, "changeable": False, "change_fee": None,
                            "policy_text": "כרטיסים מתוארכים — ללא ביטול וללא שינוי (תנאי הדגמה)"}
        hours, minutes = divmod(t.minutes, 60)
        duration_he = f"{hours} שעות" + (f" ו-{minutes} דקות" if minutes else "") if hours else f"{minutes} דקות"
        return {
            "supplier_offer_id": supplier_id(self.supplier_prefix, self.provider_id, product.code, params.date_from,
                                             params.date_to, parts),
            "title": product.name,
            "subtitle": f"{CATEGORY_HE[t.category]} · {duration_he} · {product.operator}",
            "details": {
                "kind": "activity",
                "name": product.name,
                "activity_id": f"{self.supplier_prefix}-{product.code}",
                "category": t.category,
                "city": city.name_he,
                "description": (
                    f"מפעיל: {product.operator}. {product.name} — פעילות הדגמה עם מיקום אמיתי ומפעיל בדיוני. "
                    f"שפות: {', '.join(product.languages)}."
                ),
                "duration_minutes": t.minutes,
                "available_dates": available[:31],
                "start_times": list(t.starts),
                "languages": list(product.languages),
                "meeting_point": f"נקודת מפגש ב{city.name_he.split(' (')[0]} — פרטים מלאים יישלחו לאחר ההזמנה (הדגמה)",
                "latitude": product.lat,
                "longitude": product.lon,
                "rating": product.rating,
                "review_count": product.reviews,
                "family_friendly": t.family,
                "min_age": t.min_age or None,
                "accessibility_features": list(product.accessibility),
                "participants": parts,
            },
            "price": {"currency": cur, "components": components, "excluded_notes": [],
                      "persons": sum(parts.values())},
            "cancellation": cancellation,
            "warnings": warnings,
        }


class DemoFunTripAdapter(DemoActivityAdapter):
    provider_id = "demo_funtrip"
    display_name = "דמו פאן-טריפ"
    supplier_prefix = "FTP"
    description = "משווק אטרקציות בדיוני: סיורים, מוזיאונים, אוכל ופעילויות לכל הגילים."
    sell_threshold = 0.8
    markup_range = (-0.03, 0.03)


class DemoKidVenturesAdapter(DemoActivityAdapter):
    provider_id = "demo_kidventures"
    display_name = "דמו קידוונצ'רס"
    supplier_prefix = "KDV"
    description = "משווק אטרקציות בדיוני המתמחה בפעילויות למשפחות עם ילדים; גובה דמי הזמנה."
    family_only = True
    sell_threshold = 0.85
    markup_range = (-0.04, 0.02)
    booking_fee_usd_per_ticket = Decimal("1.5")

    # ---- DEMO supplier-hosted checkout (docs/security/booking-safety.md §5) ----
    # The only DEMO provider that, besides simulation, lets the user "complete on the supplier's site".
    # That site is an IN-APP page (same origin); this adapter never returns an external URL.
    demo_checkout_path: ClassVar[str] = "/demo-supplier/checkout"
    _CHECKOUT_REF_RE: ClassVar[re.Pattern[str]] = re.compile(r"[A-Za-z0-9_-]{16,64}")

    def capabilities(self) -> ProviderCapabilities:
        caps = super().capabilities()
        return caps.model_copy(update={
            "supports_hosted_checkout": True,
            "notes": f"{caps.notes} תומך גם בהדגמת „השלמה באתר הספק” דרך דף ספק לדוגמה בתוך המערכת (ללא חיוב).",
        })

    def booking_options(self, offer: CanonicalOffer, *, checkout_ref: str | None = None) -> BookingOptions:
        """Simulation, plus a hosted checkout on the in-app DEMO supplier page.

        ``checkout_ref`` is the opaque id of the checkout session the booking service opened for one
        approved booking. Without it the link carries an offer-derived placeholder for which no session
        exists (it only tells the caller that this supplier has a checkout page).
        """
        ref = checkout_ref if checkout_ref and self._CHECKOUT_REF_RE.fullmatch(checkout_ref) else hashlib.sha256(
            f"{self.provider_id}:checkout:{offer.source.supplier_offer_id}".encode()).hexdigest()[:32]
        return BookingOptions(
            hosted_checkout_url=f"{self.demo_checkout_path}?ref={ref}",
            simulation_available=True,
            live_api_booking=False,
            instructions=(
                "זוהי הצעת הדגמה. אפשר לתרגל סימולציה, או לתרגל „השלמה באתר הספק”: ייפתח דף ספק לדוגמה בתוך המערכת, "
                "ובסיומו תוצג אסמכתה לדוגמה שיש לרשום בהזמנה. לא תתבצע הזמנה אמיתית, לא יבוצע חיוב ולא יישלחו פרטים לספק."
            ),
        )
