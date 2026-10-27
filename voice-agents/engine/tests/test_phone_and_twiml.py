import xml.etree.ElementTree as ET

import pytest
from twilio.request_validator import RequestValidator

from app.telephony.phone import InvalidPhoneNumber, display_il_number, normalize_il_number
from app.telephony.signature import compute_signature, is_valid_signature
from app.telephony.twilio_api import dial_twiml, say_and_hangup_twiml, stream_twiml


@pytest.mark.parametrize(
    "raw",
    ["053-2413215", "0532413215", "+972 53 241 3215", "972532413215", "00972532413215", "+972-053-2413215"],
)
def test_mobile_formats(raw):
    assert normalize_il_number(raw) == "+972532413215"


def test_landline_and_display():
    assert normalize_il_number("(03) 555-1234") == "+97235551234"
    assert display_il_number("+972532413215") == "053-2413215"
    assert display_il_number("+97235551234") == "03-5551234"


@pytest.mark.parametrize("raw", ["", "123", "+1 415 555 0100", "05324132150000", "abc", "[למלא: נייד]"])
def test_rejects_non_israeli(raw):
    with pytest.raises(InvalidPhoneNumber):
        normalize_il_number(raw)


def test_signature_matches_official_twilio_validator():
    url = "https://engine.test/twilio/voice?agent=kerem-toys-orders"
    params = {"CallSid": "CA123", "From": "+972532413215", "To": "+97233000000"}
    official = RequestValidator("twilio-token").compute_signature(url, params)
    assert compute_signature("twilio-token", url, params) == official
    assert is_valid_signature("twilio-token", url, params, official)
    assert not is_valid_signature("twilio-token", url, {**params, "From": "+972500000000"}, official)
    assert not is_valid_signature("", url, params, official)


def test_twiml_escapes_values():
    url, value = "wss://e.test/s?a=1&b=\"2'", "x\"<y>'"
    stream = ET.fromstring(stream_twiml(url, {"call_id": value})).find("Connect/Stream")
    assert stream.get("url") == url
    assert stream.find("Parameter").attrib == {"name": "call_id", "value": value}

    dial = ET.fromstring(dial_twiml("+97250<1", "+9723")).find("Dial")
    assert dial.text == "+97250<1" and dial.get("callerId") == "+9723"
    assert ET.fromstring(say_and_hangup_twiml("a & b")).find("Say").text == "a & b"
