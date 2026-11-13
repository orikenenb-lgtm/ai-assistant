"""DEMO adapters: determinism, real geography, realistic data, overlap, revalidation."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.core.db import utcnow
from app.modules.providers import registry
from app.modules.providers.base import ProviderUnsupportedError, SearchContext
from app.modules.providers.data.geo import AIRPORTS, CITIES, haversine_km, resolve_airport, resolve_city
from app.modules.providers.demo import DEMO_NOTE
from app.modules.providers.demo.hotels import KOSHER_FIXTURE
from app.modules.providers.normalization import finalize_offer, validate_breakdown
from app.schemas.search import ActivitySearchParams, CarSearchParams, FlightSearchParams, HotelSearchParams

TODAY = date.today()


def future(days: int) -> date:
    return TODAY + timedelta(days=days)


def next_month_day(month: int, day: int) -> date:
    d = date(TODAY.year, month, day)
    return d if d > TODAY + timedelta(days=2) else date(TODAY.year + 1, month, day)


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    yield
    registry.reset_registry()


def ctx() -> SearchContext:
    return SearchContext(search_id="test", started_at=utcnow(), timeout_seconds=5)


def offers_for(provider_id: str, params):
    adapter = registry.get_adapter(provider_id)
    c = ctx()
    return [finalize_offer(adapter, adapter.normalize(params.category, r, c)) for r in adapter.search(params.category, params, c)]


def flight_params(**kw) -> FlightSearchParams:
    base = {"origin": "TLV", "destination": "FCO", "depart_date": future(35), "return_date": future(42), "adults": 2,
            "children_ages": [7]}
    base.update(kw)
    return FlightSearchParams(**base)


def hotel_params(**kw) -> HotelSearchParams:
    base = {"destination": "רומא", "check_in": future(35), "check_out": future(39), "rooms": [{"adults": 2, "children_ages": [7]}]}
    base.update(kw)
    return HotelSearchParams(**base)


def car_params(**kw) -> CarSearchParams:
    pickup = datetime.combine(future(35), datetime.min.time()).replace(hour=10)
    base = {"pickup_location": "FCO", "pickup_at": pickup, "dropoff_at": pickup + timedelta(days=5), "driver_age": 35}
    base.update(kw)
    return CarSearchParams(**base)


def activity_params(**kw) -> ActivitySearchParams:
    base = {"destination": "Rome", "date_from": future(35), "date_to": future(39), "adults": 2, "children_ages": [8]}
    base.update(kw)
    return ActivitySearchParams(**base)


PARAMS = {"flight": flight_params, "hotel": hotel_params, "car": car_params, "activity": activity_params}


def _stable(offer) -> dict:
    return offer.model_dump(mode="json", exclude={"source": {"fetched_at", "expires_at"}})


# ------------------------------------------------------------------ geography


def test_geo_dataset_and_resolution():
    assert len(AIRPORTS) >= 40 and len(CITIES) >= 40
    for code in ("TLV", "ETM", "VDA", "LCA", "ATH", "SKG", "HER", "RHO", "FCO", "MXP", "VCE", "NAP", "CDG", "NCE", "BCN",
                 "MAD", "LIS", "LHR", "AMS", "BER", "MUC", "FRA", "VIE", "PRG", "BUD", "WAW", "KRK", "OTP", "SOF", "BEG",
                 "TBS", "IST", "DXB", "AUH", "BKK", "HKT", "NRT", "JFK", "EWR", "MIA", "LAX", "YYZ"):
        assert code in AIRPORTS, code
        assert ZoneInfo(CITIES[AIRPORTS[code].city_code].tz)
    for text in ("רומא", "Rome", "ROME", "ROM", "FCO", "roma", "  rome "):
        assert resolve_city(text).code == "ROM", text
    assert resolve_city("ניו-יורק").code == "NYC"
    assert resolve_city("München").code == "MUC"
    assert resolve_city("כרתים").code == "HER"
    assert resolve_city("לוס אנג׳לס").code == "LAX"  # Hebrew geresh variant
    assert resolve_city("Atlantis") is None
    assert resolve_airport("LON").iata == "LHR"
    assert resolve_airport("פריז").iata == "CDG"
    # TLV-JFK great-circle distance is ~9,100 km
    assert 9000 < haversine_km(AIRPORTS["TLV"].lat, AIRPORTS["TLV"].lon, AIRPORTS["JFK"].lat, AIRPORTS["JFK"].lon) < 9300


# -------------------------------------------------------------- determinism


@pytest.mark.parametrize("category", ["flight", "hotel", "car", "activity"])
def test_two_providers_per_category_and_determinism(category):
    providers = [a for a in registry.adapters_for_category(category) if a.capabilities().mode == "DEMO"]
    assert len(providers) >= 2
    params = PARAMS[category]()
    for adapter in providers:
        first = offers_for(adapter.provider_id, params)
        second = offers_for(adapter.provider_id, params)
        assert first, f"{adapter.provider_id} returned no offers"
        assert [_stable(o) for o in first] == [_stable(o) for o in second]
        for o in first:
            assert o.source.mode == "DEMO"
            assert o.source.note == DEMO_NOTE
            assert o.source.deep_link is None
            assert o.source.provider_id == adapter.provider_id
            assert o.source.expires_at - o.source.fetched_at == timedelta(minutes=30)
            assert o.dedupe_key.startswith(f"{category}:")
            validate_breakdown(o.price)  # total == sum(included components)
            included = sum(c.amount.amount for c in o.price.components if c.included_in_total)
            assert included == o.price.total.amount
            assert all("(דמו)" in s for s in _supplier_brands(o))


def _supplier_brands(o) -> list[str]:
    d = o.details
    if d.kind == "flight":
        return [s.carrier_name for sl in d.slices for s in sl.segments]
    if d.kind == "hotel":
        return [d.hotel_name]
    if d.kind == "car":
        return [d.vendor]
    return [o.subtitle or ""]


@pytest.mark.parametrize("category", ["flight", "hotel", "car", "activity"])
def test_providers_overlap_on_equivalent_products(category):
    a, b = [x.provider_id for x in registry.adapters_for_category(category) if x.capabilities().mode == "DEMO"][:2]
    params = PARAMS[category]()
    keys_a = {o.dedupe_key: o for o in offers_for(a, params)}
    keys_b = {o.dedupe_key: o for o in offers_for(b, params)}
    shared = set(keys_a) & set(keys_b)
    assert shared, "DEMO providers must overlap on some truly-equivalent products"
    # Same product at (slightly) different prices
    assert any(keys_a[k].price.total.amount != keys_b[k].price.total.amount for k in shared)
    # ... and each provider also has products the other does not sell
    assert set(keys_a) - set(keys_b) or set(keys_b) - set(keys_a)


# ------------------------------------------------------------------ flights


def test_flight_times_use_real_timezones_and_distance():
    winter = flight_params(depart_date=next_month_day(1, 20), return_date=next_month_day(1, 27), children_ages=[])
    summer = flight_params(depart_date=next_month_day(7, 15), return_date=next_month_day(7, 22), children_ages=[])
    expected_tlv = {winter.depart_date: timedelta(hours=2), summer.depart_date: timedelta(hours=3)}
    for params in (winter, summer):
        offers = offers_for("demo_skyline", params)
        assert offers
        for o in offers:
            for sl in o.details.slices:
                for seg in sl.segments:
                    # Duration is consistent with the UTC difference of local times
                    assert (seg.arriving_at - seg.departing_at) == timedelta(minutes=seg.duration_minutes)
                    for code, ts in ((seg.origin, seg.departing_at), (seg.destination, seg.arriving_at)):
                        tz = ZoneInfo(CITIES[AIRPORTS[code].city_code].tz)
                        assert ts.utcoffset() == ts.astimezone(tz).utcoffset()
                    if seg.origin == "TLV" and seg.departing_at.date() == params.depart_date:
                        assert seg.departing_at.utcoffset() == expected_tlv[params.depart_date]
                # Slice duration covers the layovers
                assert sl.duration_minutes == sum(s.duration_minutes for s in sl.segments) + sum(sl.layovers_minutes)
                assert sl.stops == len(sl.segments) - 1


def test_flight_durations_scale_with_distance_and_stops_vary():
    short = offers_for("demo_skyline", flight_params(destination="ATH", return_date=None, children_ages=[]))
    long_ = offers_for("demo_skyline", flight_params(destination="JFK", return_date=None, children_ages=[]))
    nonstop_short = [o for o in short if o.details.max_stops == 0]
    nonstop_long = [o for o in long_ if o.details.max_stops == 0]
    assert nonstop_short and nonstop_long
    assert all(90 <= o.details.total_duration_minutes <= 160 for o in nonstop_short)
    assert all(600 <= o.details.total_duration_minutes <= 780 for o in nonstop_long)
    assert {o.details.max_stops for o in short + long_} >= {0, 1}


def test_flight_price_scales_with_passengers_and_cabin():
    two = offers_for("demo_skyline", flight_params(adults=2, children_ages=[]))
    three = offers_for("demo_skyline", flight_params(adults=3, children_ages=[]))
    biz = offers_for("demo_skyline", flight_params(adults=2, children_ages=[], cabin="business"))

    def by_product(offers):
        return {(tuple(s.flight_number for sl in o.details.slices for s in sl.segments), o.details.fare_brand): o
                for o in offers}

    p2, p3 = by_product(two), by_product(three)
    common = set(p2) & set(p3)
    assert common
    for k in common:
        assert p3[k].price.total.amount > p2[k].price.total.amount
        assert p3[k].details.passengers["adult"] == 3
    assert min(o.price.total.amount for o in biz) > min(o.price.total.amount for o in two) * 2
    assert all(o.details.cabin == "business" for o in biz)


def test_flight_fare_brands_baggage_and_rules():
    offers = offers_for("demo_skyline", flight_params(checked_bags=1))
    brands = {o.details.fare_brand for o in offers}
    assert {"לייט", "קלאסיק", "פלקס"} & brands
    for o in offers:
        b = o.details.baggage
        if o.details.fare_brand == "פלקס":
            assert o.cancellation.refundable is True and b.checked_included == 1
        if o.details.fare_brand in ("לייט", "בייסיק"):
            assert o.cancellation.refundable is False and b.checked_included == 0
            # Requested checked bag is NOT included: estimated, excluded component + warning
            extra = [c for c in o.price.components if c.kind == "extra"]
            assert extra and extra[0].status == "estimated" and not extra[0].included_in_total
            assert o.warnings and o.price.excluded_notes
        assert o.price.per_person is not None
        assert o.details.passengers == {"adult": 2, "child": 1, "infant": 0}


def test_flight_infant_and_teen_passenger_types():
    offers = offers_for("demo_aurora", flight_params(adults=1, children_ages=[15, 9, 1]))
    assert offers
    assert offers[0].details.passengers == {"adult": 2, "child": 1, "infant": 1}
    labels = [c.label for c in offers[0].price.components]
    assert any("תינוק" in lbl for lbl in labels) and any("ילד" in lbl for lbl in labels)
    assert any(c.kind == "fee" for c in offers[0].price.components)  # Aurora's service fee


def test_unknown_airport_is_unsupported():
    adapter = registry.get_adapter("demo_skyline")
    with pytest.raises(ProviderUnsupportedError):
        adapter.search("flight", flight_params(destination="XYZ"), ctx())


def test_flex_days_bounded_and_no_past_dates():
    offers = offers_for("demo_skyline", flight_params(depart_date=future(1), return_date=future(5), flex_days=3))
    assert offers
    for o in offers:
        assert o.details.slices[0].departing_at.date() >= TODAY


# ------------------------------------------------------------------- hotels


def test_hotels_city_tax_excluded_geo_and_kosher_fixture():
    params = hotel_params()
    rome = CITIES["ROM"]
    for pid in ("demo_stayplus", "demo_hotelia"):
        offers = offers_for(pid, params)
        assert offers
        for o in offers:
            d = o.details
            assert d.nights == 4 and d.check_in == params.check_in
            assert haversine_km(rome.lat, rome.lon, d.latitude, d.longitude) < 10
            assert d.distance_to_center_km is not None
            tax = [c for c in o.price.components if "מס עירוני" in c.label]
            assert tax and tax[0].status == "excluded" and tax[0].included_in_total is False
            assert tax[0].amount.currency == "EUR"
            assert any("מס עירוני משולם במלון" in n for n in o.price.excluded_notes)
            assert d.kosher_info in (None, KOSHER_FIXTURE)
            assert o.price.per_night is not None
            if o.cancellation.refundable:
                assert o.cancellation.free_cancellation_until is not None
                assert o.cancellation.free_cancellation_until.date() < params.check_in


def test_hotel_rooms_fit_occupancy_and_price_scales_with_nights():
    big = hotel_params(rooms=[{"adults": 2, "children_ages": [4, 9]}, {"adults": 2, "children_ages": []}])
    offers = offers_for("demo_stayplus", big)
    assert offers
    assert all(o.details.rooms == 2 and o.details.adults == 4 and o.details.children == 2 for o in offers)
    short = {o.dedupe_key.split(":")[0] + o.details.hotel_name + o.details.board: o
             for o in offers_for("demo_stayplus", hotel_params(check_out=future(37)))}
    long_ = {o.dedupe_key.split(":")[0] + o.details.hotel_name + o.details.board: o
             for o in offers_for("demo_stayplus", hotel_params(check_out=future(41)))}
    common = set(short) & set(long_)
    assert common
    assert all(long_[k].price.total.amount > short[k].price.total.amount for k in common)


def test_unknown_city_is_unsupported():
    with pytest.raises(ProviderUnsupportedError):
        registry.get_adapter("demo_hotelia").search("hotel", hotel_params(destination="Atlantis"), ctx())


# --------------------------------------------------------------------- cars


def test_car_young_driver_fee_known_vs_estimated():
    young = car_params(driver_age=23)
    drive = offers_for("demo_drive", young)
    rentway = offers_for("demo_rentway", young)
    assert drive and rentway
    for o in drive:
        fee = [c for c in o.price.components if "נהג צעיר" in c.label]
        assert fee and fee[0].status == "known" and fee[0].included_in_total
        assert o.details.young_driver_fee_applies is True
    for o in rentway:
        fee = [c for c in o.price.components if "נהג צעיר" in c.label]
        assert fee and fee[0].status == "estimated" and not fee[0].included_in_total
        assert any("נהג צעיר" in w for w in o.warnings)
    adult = offers_for("demo_drive", car_params(driver_age=40))
    assert all(not any("נהג צעיר" in c.label for c in o.price.components) for o in adult)
    assert all(o.details.young_driver_fee_applies is False for o in adult)
    # Premium cars require age 25+
    assert all(o.details.car_class != "premium" for o in drive + rentway)


def test_car_details_realistic():
    params = car_params()
    offers = offers_for("demo_rentway", params)
    assert offers
    for o in offers:
        d = o.details
        assert d.rental_days == 5
        assert d.pickup_at.utcoffset() == ZoneInfo("Europe/Rome").utcoffset(params.pickup_at)
        assert d.pickup_at.hour == 10
        assert d.insurance_included and d.deposit is not None and d.deposit.currency == "ILS"
        assert d.mileage in ("unlimited", "200km/day")
        assert d.transmission in ("manual", "automatic")
        assert o.price.per_day is not None
    assert {o.details.transmission for o in offers} == {"manual", "automatic"}  # Europe offers both


def test_car_city_pickup_and_one_way():
    offers = offers_for("demo_drive", car_params(pickup_location="מילאנו", dropoff_location="רומא"))
    assert offers
    assert all("סניף מרכז העיר" in o.details.pickup_location for o in offers)
    assert all(any("החזרה במיקום אחר" in c.label for c in o.price.components) for o in offers)
    # Cross-border one-way is not offered by DEMO vendors
    assert offers_for("demo_drive", car_params(pickup_location="FCO", dropoff_location="CDG")) == []


# --------------------------------------------------------------- activities


def test_activities_child_pricing_and_family_fields():
    offers = offers_for("demo_funtrip", activity_params(children_ages=[8, 1]))
    assert offers
    for o in offers:
        d = o.details
        assert d.participants == {"adult": 2, "child": 1, "infant": 1}
        assert d.available_dates and all(future(35) <= x <= future(39) for x in d.available_dates)
        assert d.start_times and d.duration_minutes
        assert d.category in ("museum", "tour", "outdoor", "family", "food", "water", "nightlife", "shopping",
                              "culture", "adventure")
    assert any(any("ילד" in c.label for c in o.price.components) for o in offers)
    kid = offers_for("demo_kidventures", activity_params())
    assert kid and all(o.details.family_friendly for o in kid)


# ------------------------------------------------------ revalidate / booking


def test_revalidate_default_overrides_markers_and_settings():
    adapter = registry.get_adapter("demo_stayplus")
    offer = offers_for("demo_stayplus", hotel_params())[0]
    res = adapter.revalidate(offer)
    assert res.status == "unchanged" and res.refreshed_offer is not None
    assert res.new_total == offer.price.total
    # Deterministic: same answer twice
    assert adapter.revalidate(offer).status == "unchanged"

    adapter.set_revalidation_override(offer.source.supplier_offer_id, "price_changed")
    res = adapter.revalidate(offer)
    assert res.status == "price_changed"
    assert res.new_total.amount > offer.price.total.amount
    validate_breakdown(res.refreshed_offer.price)
    adapter.set_revalidation_override(offer.source.supplier_offer_id, None)

    marked = offer.model_copy(update={"source": offer.source.model_copy(
        update={"supplier_offer_id": offer.source.supplier_offer_id + "~EXPIRED"})})
    assert adapter.revalidate(marked).status == "expired"
    assert adapter.revalidate(offer, settings={"revalidation_scenario": "unavailable"}).status == "unavailable"
    other = registry.get_adapter("demo_hotelia")
    assert other.revalidate(offer).status == "error"


def test_booking_options_are_simulation_only():
    adapter = registry.get_adapter("demo_skyline")
    offer = offers_for("demo_skyline", flight_params())[0]
    opts = adapter.booking_options(offer)
    assert opts.simulation_available is True
    assert opts.hosted_checkout_url is None
    assert opts.live_api_booking is False
    assert "סימולציה" in opts.instructions


def test_demo_settings_max_results_and_simulated_error():
    adapter = registry.get_adapter("demo_skyline")
    c = ctx()
    c.provider_settings = {"max_results": 3}
    assert len(adapter.search("flight", flight_params(), c)) == 3
    c.provider_settings = {"simulate_error": True}
    from app.modules.providers.base import ProviderError

    with pytest.raises(ProviderError):
        adapter.search("flight", flight_params(), c)


def test_prices_are_decimal_in_requested_currency():
    for currency in ("ILS", "EUR", "JPY"):
        offers = offers_for("demo_aurora", flight_params(currency=currency))
        assert offers
        for o in offers:
            assert o.price.total.currency == currency
            assert isinstance(o.price.total.amount, Decimal)
            if currency == "JPY":
                assert o.price.total.amount == o.price.total.amount.to_integral_value()
