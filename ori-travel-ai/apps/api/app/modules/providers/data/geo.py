"""Static geography fixture: airports and cities relevant to Israeli families.

Real-world data (approximate WGS84 coordinates, IANA time zones, IATA airport
and metropolitan city codes). DEMO adapters combine this REAL geography with
FICTIONAL suppliers. It is also used to resolve free-text destinations
(Hebrew / English / IATA code) for hotel, car and activity searches.

Everything here is offline. ``utc_fallback`` is the standard UTC offset used
only when the system time-zone database is unavailable (e.g. Windows without
the ``tzdata`` package); DST is then ignored.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class City:
    code: str  # IATA city / metropolitan area code (e.g. ROM, LON, NYC)
    name_he: str
    name_en: str
    country_code: str  # ISO 3166-1 alpha-2
    country_he: str
    tz: str  # IANA time zone
    lat: float  # city centre
    lon: float
    airports: tuple[str, ...]  # primary airport first
    aliases: tuple[str, ...] = ()
    coastal: bool = False  # beach / sea / lagoon destination
    cost_index: int = 100  # approx. USD per night, 3-star double room (DEMO pricing input)
    region: str = "europe_west"
    local_currency: str | None = None  # for locally-paid taxes (city tax)
    utc_fallback: float = 0.0


@dataclass(frozen=True)
class Airport:
    iata: str
    name_he: str
    name_en: str
    city_code: str
    lat: float
    lon: float


# fmt: off
_CITIES: tuple[City, ...] = (
    City("TLV", "תל אביב", "Tel Aviv", "IL", "ישראל", "Asia/Jerusalem", 32.0853, 34.7818, ("TLV",),
         ("תל אביב יפו", "תל-אביב", "תל אביב-יפו", "tel aviv-yafo", "tel-aviv", "tel aviv yafo", "יפו", "jaffa"),
         True, 220, "israel", "ILS", 2),
    City("ETH", "אילת", "Eilat", "IL", "ישראל", "Asia/Jerusalem", 29.5577, 34.9519, ("ETM", "VDA"),
         ("elat", "eilat"), True, 200, "israel", "ILS", 2),
    City("LCA", "לרנקה", "Larnaca", "CY", "קפריסין", "Asia/Nicosia", 34.9167, 33.6333, ("LCA",),
         ("larnaka",), True, 110, "europe_south", "EUR", 2),
    City("PFO", "פאפוס", "Paphos", "CY", "קפריסין", "Asia/Nicosia", 34.7754, 32.4245, ("PFO",),
         ("pafos", "פפוס"), True, 120, "europe_south", "EUR", 2),
    City("ATH", "אתונה", "Athens", "GR", "יוון", "Europe/Athens", 37.9838, 23.7275, ("ATH",),
         ("athina", "אטונה"), True, 110, "europe_south", "EUR", 2),
    City("SKG", "סלוניקי", "Thessaloniki", "GR", "יוון", "Europe/Athens", 40.6401, 22.9444, ("SKG",),
         ("saloniki", "salonica", "תסלוניקי"), True, 90, "europe_south", "EUR", 2),
    City("HER", "הרקליון (כרתים)", "Heraklion (Crete)", "GR", "יוון", "Europe/Athens", 35.3387, 25.1442, ("HER",),
         ("heraklion", "iraklio", "crete", "כרתים", "הרקליון"), True, 120, "europe_south", "EUR", 2),
    City("RHO", "רודוס", "Rhodes", "GR", "יוון", "Europe/Athens", 36.4341, 28.2176, ("RHO",),
         ("rodos",), True, 115, "europe_south", "EUR", 2),
    City("CFU", "קורפו", "Corfu", "GR", "יוון", "Europe/Athens", 39.6243, 19.9217, ("CFU",),
         ("kerkyra",), True, 115, "europe_south", "EUR", 2),
    City("ROM", "רומא", "Rome", "IT", "איטליה", "Europe/Rome", 41.9028, 12.4964, ("FCO", "CIA"),
         ("roma",), False, 150, "europe_west", "EUR", 1),
    City("MIL", "מילאנו", "Milan", "IT", "איטליה", "Europe/Rome", 45.4642, 9.1900, ("MXP", "LIN"),
         ("milano",), False, 160, "europe_west", "EUR", 1),
    City("VCE", "ונציה", "Venice", "IT", "איטליה", "Europe/Rome", 45.4408, 12.3155, ("VCE",),
         ("venezia", "venedig"), True, 190, "europe_west", "EUR", 1),
    City("NAP", "נאפולי", "Naples", "IT", "איטליה", "Europe/Rome", 40.8518, 14.2681, ("NAP",),
         ("napoli",), True, 110, "europe_south", "EUR", 1),
    City("PAR", "פריז", "Paris", "FR", "צרפת", "Europe/Paris", 48.8566, 2.3522, ("CDG", "ORY"),
         ("פריס",), False, 200, "europe_west", "EUR", 1),
    City("NCE", "ניס", "Nice", "FR", "צרפת", "Europe/Paris", 43.7102, 7.2620, ("NCE",),
         ("nizza",), True, 170, "europe_west", "EUR", 1),
    City("BCN", "ברצלונה", "Barcelona", "ES", "ספרד", "Europe/Madrid", 41.3874, 2.1686, ("BCN",),
         (), True, 160, "europe_south", "EUR", 1),
    City("MAD", "מדריד", "Madrid", "ES", "ספרד", "Europe/Madrid", 40.4168, -3.7038, ("MAD",),
         (), False, 130, "europe_south", None, 1),
    City("PMI", "פלמה דה מיורקה", "Palma de Mallorca", "ES", "ספרד", "Europe/Madrid", 39.5696, 2.6502, ("PMI",),
         ("mallorca", "majorca", "palma", "מיורקה", "מאיורקה"), True, 150, "europe_south", "EUR", 1),
    City("LIS", "ליסבון", "Lisbon", "PT", "פורטוגל", "Europe/Lisbon", 38.7223, -9.1393, ("LIS",),
         ("lisboa",), True, 130, "europe_south", "EUR", 0),
    City("LON", "לונדון", "London", "GB", "בריטניה", "Europe/London", 51.5074, -0.1278, ("LHR", "LTN"),
         (), False, 210, "europe_west", None, 0),
    City("AMS", "אמסטרדם", "Amsterdam", "NL", "הולנד", "Europe/Amsterdam", 52.3676, 4.9041, ("AMS",),
         (), False, 190, "europe_west", "EUR", 1),
    City("BER", "ברלין", "Berlin", "DE", "גרמניה", "Europe/Berlin", 52.5200, 13.4050, ("BER",),
         (), False, 120, "europe_west", "EUR", 1),
    City("MUC", "מינכן", "Munich", "DE", "גרמניה", "Europe/Berlin", 48.1351, 11.5820, ("MUC",),
         ("munchen", "muenchen"), False, 150, "europe_west", None, 1),
    City("FRA", "פרנקפורט", "Frankfurt", "DE", "גרמניה", "Europe/Berlin", 50.1109, 8.6821, ("FRA",),
         ("frankfurt am main",), False, 140, "europe_west", "EUR", 1),
    City("ZRH", "ציריך", "Zurich", "CH", "שווייץ", "Europe/Zurich", 47.3769, 8.5417, ("ZRH",),
         ("zurich", "צוריך"), False, 230, "switzerland", "CHF", 1),
    City("VIE", "וינה", "Vienna", "AT", "אוסטריה", "Europe/Vienna", 48.2082, 16.3738, ("VIE",),
         ("wien",), False, 130, "europe_west", "EUR", 1),
    City("PRG", "פראג", "Prague", "CZ", "צ'כיה", "Europe/Prague", 50.0755, 14.4378, ("PRG",),
         ("praha",), False, 95, "europe_east", "CZK", 1),
    City("BUD", "בודפשט", "Budapest", "HU", "הונגריה", "Europe/Budapest", 47.4979, 19.0402, ("BUD",),
         (), False, 85, "europe_east", "HUF", 1),
    City("WAW", "ורשה", "Warsaw", "PL", "פולין", "Europe/Warsaw", 52.2297, 21.0122, ("WAW",),
         ("warszawa", "וארשה"), False, 85, "europe_east", None, 1),
    City("KRK", "קרקוב", "Krakow", "PL", "פולין", "Europe/Warsaw", 50.0647, 19.9450, ("KRK",),
         ("cracow",), False, 75, "europe_east", "PLN", 1),
    City("BUH", "בוקרשט", "Bucharest", "RO", "רומניה", "Europe/Bucharest", 44.4268, 26.1025, ("OTP",),
         ("bucuresti",), False, 75, "europe_east", "RON", 2),
    City("SOF", "סופיה", "Sofia", "BG", "בולגריה", "Europe/Sofia", 42.6977, 23.3219, ("SOF",),
         (), False, 65, "europe_east", "EUR", 2),
    City("BEG", "בלגרד", "Belgrade", "RS", "סרביה", "Europe/Belgrade", 44.7866, 20.4489, ("BEG",),
         ("beograd",), False, 70, "europe_east", None, 1),
    City("TBS", "טביליסי", "Tbilisi", "GE", "גאורגיה", "Asia/Tbilisi", 41.7151, 44.8271, ("TBS",),
         ("tiflis", "טיביליסי"), False, 65, "caucasus", None, 4),
    City("BUS", "בטומי", "Batumi", "GE", "גאורגיה", "Asia/Tbilisi", 41.6168, 41.6367, ("BUS",),
         (), True, 70, "caucasus", None, 4),
    City("IST", "איסטנבול", "Istanbul", "TR", "טורקיה", "Europe/Istanbul", 41.0082, 28.9784, ("IST",),
         (), True, 100, "middle_east", None, 3),
    City("MLA", "מלטה", "Malta (Valletta)", "MT", "מלטה", "Europe/Malta", 35.8989, 14.5146, ("MLA",),
         ("valletta", "ולטה", "malta"), True, 120, "europe_south", "EUR", 1),
    City("DXB", "דובאי", "Dubai", "AE", "איחוד האמירויות", "Asia/Dubai", 25.2048, 55.2708, ("DXB",),
         (), True, 160, "gulf", "AED", 4),
    City("AUH", "אבו דאבי", "Abu Dhabi", "AE", "איחוד האמירויות", "Asia/Dubai", 24.4539, 54.3773, ("AUH",),
         ("abu dabi", "אבו-דאבי"), True, 150, "gulf", None, 4),
    City("BKK", "בנגקוק", "Bangkok", "TH", "תאילנד", "Asia/Bangkok", 13.7563, 100.5018, ("BKK",),
         (), False, 70, "asia_se", None, 7),
    City("HKT", "פוקט", "Phuket", "TH", "תאילנד", "Asia/Bangkok", 7.8804, 98.3923, ("HKT",),
         (), True, 90, "asia_se", None, 7),
    City("TYO", "טוקיו", "Tokyo", "JP", "יפן", "Asia/Tokyo", 35.6762, 139.6503, ("NRT", "HND"),
         (), False, 160, "japan", "JPY", 9),
    City("NYC", "ניו יורק", "New York", "US", "ארצות הברית", "America/New_York", 40.7128, -74.0060, ("JFK", "EWR"),
         ("new york city", "ניו-יורק", "manhattan", "מנהטן"), False, 280, "north_america", None, -5),
    City("MIA", "מיאמי", "Miami", "US", "ארצות הברית", "America/New_York", 25.7617, -80.1918, ("MIA",),
         (), True, 230, "north_america", None, -5),
    City("LAX", "לוס אנג'לס", "Los Angeles", "US", "ארצות הברית", "America/Los_Angeles", 34.0522, -118.2437, ("LAX",),
         ("לוס אנגלס",), True, 220, "north_america", None, -8),
    City("YTO", "טורונטו", "Toronto", "CA", "קנדה", "America/Toronto", 43.6532, -79.3832, ("YYZ",),
         (), False, 180, "north_america", None, -5),
)

_AIRPORTS: tuple[Airport, ...] = (
    Airport("TLV", "נמל התעופה בן גוריון", "Ben Gurion Airport", "TLV", 32.0114, 34.8867),
    Airport("ETM", "נמל התעופה רמון", "Ramon Airport", "ETH", 29.7236, 35.0114),
    Airport("VDA", "נמל התעופה עובדה", "Ovda Airport", "ETH", 29.9403, 34.9358),
    Airport("LCA", "נמל התעופה לרנקה", "Larnaca International Airport", "LCA", 34.8751, 33.6249),
    Airport("PFO", "נמל התעופה פאפוס", "Paphos International Airport", "PFO", 34.7180, 32.4857),
    Airport("ATH", "נמל התעופה אלפתריוס וניזלוס", "Athens International Airport", "ATH", 37.9364, 23.9445),
    Airport("SKG", "נמל התעופה מקדוניה", "Thessaloniki Airport Makedonia", "SKG", 40.5197, 22.9709),
    Airport("HER", "נמל התעופה ניקוס קזנצאקיס", "Heraklion International Airport", "HER", 35.3397, 25.1803),
    Airport("RHO", "נמל התעופה דיאגוראס", "Rhodes International Airport", "RHO", 36.4054, 28.0862),
    Airport("CFU", "נמל התעופה יואניס קפודיסטריאס", "Corfu International Airport", "CFU", 39.6019, 19.9117),
    Airport("FCO", "נמל התעופה פיומיצ'ינו", "Rome Fiumicino Airport", "ROM", 41.8003, 12.2389),
    Airport("CIA", "נמל התעופה צ'אמפינו", "Rome Ciampino Airport", "ROM", 41.7994, 12.5949),
    Airport("MXP", "נמל התעופה מלפנסה", "Milan Malpensa Airport", "MIL", 45.6306, 8.7281),
    Airport("LIN", "נמל התעופה לינאטה", "Milan Linate Airport", "MIL", 45.4451, 9.2767),
    Airport("VCE", "נמל התעופה מרקו פולו", "Venice Marco Polo Airport", "VCE", 45.5053, 12.3519),
    Airport("NAP", "נמל התעופה נאפולי", "Naples International Airport", "NAP", 40.8860, 14.2908),
    Airport("CDG", "נמל התעופה שארל דה גול", "Paris Charles de Gaulle Airport", "PAR", 49.0097, 2.5479),
    Airport("ORY", "נמל התעופה אורלי", "Paris Orly Airport", "PAR", 48.7262, 2.3652),
    Airport("NCE", "נמל התעופה ניס קוט ד'אזור", "Nice Cote d'Azur Airport", "NCE", 43.6584, 7.2159),
    Airport("BCN", "נמל התעופה אל פראט", "Barcelona El Prat Airport", "BCN", 41.2974, 2.0833),
    Airport("MAD", "נמל התעופה ברחאס", "Madrid Barajas Airport", "MAD", 40.4983, -3.5676),
    Airport("PMI", "נמל התעופה פלמה דה מיורקה", "Palma de Mallorca Airport", "PMI", 39.5517, 2.7388),
    Airport("LIS", "נמל התעופה הומברטו דלגדו", "Lisbon Humberto Delgado Airport", "LIS", 38.7742, -9.1342),
    Airport("LHR", "נמל התעופה הית'רו", "London Heathrow Airport", "LON", 51.4700, -0.4543),
    Airport("LTN", "נמל התעופה לוטון", "London Luton Airport", "LON", 51.8747, -0.3683),
    Airport("AMS", "נמל התעופה סכיפהול", "Amsterdam Airport Schiphol", "AMS", 52.3105, 4.7683),
    Airport("BER", "נמל התעופה ברלין ברנדנבורג", "Berlin Brandenburg Airport", "BER", 52.3667, 13.5033),
    Airport("MUC", "נמל התעופה מינכן", "Munich Airport", "MUC", 48.3538, 11.7861),
    Airport("FRA", "נמל התעופה פרנקפורט", "Frankfurt Airport", "FRA", 50.0379, 8.5622),
    Airport("ZRH", "נמל התעופה ציריך", "Zurich Airport", "ZRH", 47.4582, 8.5555),
    Airport("VIE", "נמל התעופה וינה", "Vienna International Airport", "VIE", 48.1103, 16.5697),
    Airport("PRG", "נמל התעופה ואצלב האבל", "Vaclav Havel Airport Prague", "PRG", 50.1008, 14.2600),
    Airport("BUD", "נמל התעופה פרנץ ליסט", "Budapest Ferenc Liszt International Airport", "BUD", 47.4369, 19.2556),
    Airport("WAW", "נמל התעופה שופן", "Warsaw Chopin Airport", "WAW", 52.1657, 20.9671),
    Airport("KRK", "נמל התעופה יוחנן פאולוס השני", "Krakow John Paul II International Airport", "KRK", 50.0777, 19.7848),
    Airport("OTP", "נמל התעופה אנרי קואנדה", "Henri Coanda International Airport", "BUH", 44.5711, 26.0850),
    Airport("SOF", "נמל התעופה סופיה", "Sofia Airport", "SOF", 42.6967, 23.4114),
    Airport("BEG", "נמל התעופה ניקולה טסלה", "Belgrade Nikola Tesla Airport", "BEG", 44.8184, 20.3091),
    Airport("TBS", "נמל התעופה טביליסי", "Tbilisi International Airport", "TBS", 41.6692, 44.9547),
    Airport("BUS", "נמל התעופה בטומי", "Batumi International Airport", "BUS", 41.6103, 41.5997),
    Airport("IST", "נמל התעופה של איסטנבול", "Istanbul Airport", "IST", 41.2753, 28.7519),
    Airport("MLA", "נמל התעופה מלטה", "Malta International Airport", "MLA", 35.8575, 14.4775),
    Airport("DXB", "נמל התעופה דובאי", "Dubai International Airport", "DXB", 25.2532, 55.3657),
    Airport("AUH", "נמל התעופה זאיד", "Zayed International Airport", "AUH", 24.4330, 54.6511),
    Airport("BKK", "נמל התעופה סוברנבומי", "Suvarnabhumi Airport", "BKK", 13.6900, 100.7501),
    Airport("HKT", "נמל התעופה פוקט", "Phuket International Airport", "HKT", 8.1132, 98.3169),
    Airport("NRT", "נמל התעופה נריטה", "Narita International Airport", "TYO", 35.7720, 140.3929),
    Airport("HND", "נמל התעופה הנדה", "Tokyo Haneda Airport", "TYO", 35.5494, 139.7798),
    Airport("JFK", "נמל התעופה ג'ון פ. קנדי", "John F. Kennedy International Airport", "NYC", 40.6413, -73.7781),
    Airport("EWR", "נמל התעופה ניוארק", "Newark Liberty International Airport", "NYC", 40.6895, -74.1745),
    Airport("MIA", "נמל התעופה מיאמי", "Miami International Airport", "MIA", 25.7959, -80.2870),
    Airport("LAX", "נמל התעופה לוס אנג'לס", "Los Angeles International Airport", "LAX", 33.9416, -118.4085),
    Airport("YYZ", "נמל התעופה פירסון", "Toronto Pearson International Airport", "YTO", 43.6777, -79.6248),
)
# fmt: on

CITIES: dict[str, City] = {c.code: c for c in _CITIES}
AIRPORTS: dict[str, Airport] = {a.iata: a for a in _AIRPORTS}

_QUOTES_RE = re.compile(r"[\"'`׳״‘’“”]")
_SEP_RE = re.compile(r"[\s\-_,./()]+")


def normalize_place(text: str) -> str:
    """Lower-case, strip accents/quotes/punctuation for lenient name matching."""
    s = unicodedata.normalize("NFKD", text.strip().casefold())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = _QUOTES_RE.sub("", s)
    s = _SEP_RE.sub(" ", s)
    return s.strip()


@lru_cache(maxsize=1)
def _alias_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for city in _CITIES:
        names = (city.name_he, city.name_en, city.code, *city.aliases)
        for name in names:
            index.setdefault(normalize_place(name), city.code)
        # "הרקליון (כרתים)" -> also "הרקליון" ; "Malta (Valletta)" -> "malta"
        for name in (city.name_he, city.name_en):
            base = name.split("(")[0]
            index.setdefault(normalize_place(base), city.code)
    for airport in _AIRPORTS:
        index.setdefault(normalize_place(airport.iata), airport.city_code)
        index.setdefault(normalize_place(airport.name_en), airport.city_code)
        index.setdefault(normalize_place(airport.name_he), airport.city_code)
    return index


def get_airport(code: str) -> Airport | None:
    return AIRPORTS.get(code.strip().upper())


def get_city(code: str) -> City | None:
    return CITIES.get(code.strip().upper())


def city_of_airport(airport: Airport) -> City:
    return CITIES[airport.city_code]


def resolve_city(text: str | None) -> City | None:
    """Resolve 'רומא' / 'Rome' / 'ROM' / 'FCO' to a City (None when unknown)."""
    if not text:
        return None
    raw = text.strip()
    if len(raw) == 3 and raw.isascii() and raw.isalpha():
        code = raw.upper()
        if code in CITIES:
            return CITIES[code]
        if code in AIRPORTS:
            return CITIES[AIRPORTS[code].city_code]
    code = _alias_index().get(normalize_place(raw))
    return CITIES.get(code) if code else None


def resolve_airport(code_or_name: str | None) -> Airport | None:
    """Resolve an IATA airport code, a city code (primary airport) or a city name."""
    if not code_or_name:
        return None
    raw = code_or_name.strip()
    if len(raw) == 3 and raw.isascii() and raw.isalpha():
        code = raw.upper()
        if code in AIRPORTS:
            return AIRPORTS[code]
        if code in CITIES:
            return AIRPORTS[CITIES[code].airports[0]]
    city = resolve_city(raw)
    return AIRPORTS[city.airports[0]] if city else None


# ---------------- time zones ----------------


@lru_cache(maxsize=128)
def zone(tz_name: str, fallback_hours: float = 0.0) -> tzinfo:
    """IANA zone, or a fixed standard offset when the tz database is missing."""
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):  # pragma: no cover - platform dependent
        return timezone(timedelta(hours=fallback_hours))


def city_zone(city: City) -> tzinfo:
    return zone(city.tz, city.utc_fallback)


def airport_zone(airport: Airport) -> tzinfo:
    return city_zone(CITIES[airport.city_code])


def local_datetime(day: date, minutes_after_midnight: int, tz: tzinfo) -> datetime:
    """Aware local wall-clock datetime (handles DST via zoneinfo)."""
    hh, mm = divmod(minutes_after_midnight, 60)
    return datetime.combine(day, time(hh % 24, mm), tzinfo=tz) + timedelta(days=hh // 24)


# ---------------- geometry ----------------

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def airport_distance_km(a: Airport, b: Airport) -> float:
    return haversine_km(a.lat, a.lon, b.lat, b.lon)


def offset_point(lat: float, lon: float, distance_km: float, bearing_deg: float) -> tuple[float, float]:
    """Destination point given distance and bearing (spherical earth)."""
    d = distance_km / EARTH_RADIUS_KM
    br = math.radians(bearing_deg)
    p1 = math.radians(lat)
    l1 = math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(br))
    l2 = l1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return round(math.degrees(p2), 5), round((math.degrees(l2) + 540) % 360 - 180, 5)
