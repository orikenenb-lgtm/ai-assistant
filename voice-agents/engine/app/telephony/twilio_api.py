"""The small slice of the Twilio REST API the engine uses, plus TwiML builders."""

from xml.sax.saxutils import escape, quoteattr

import httpx
from loguru import logger

API = "https://api.twilio.com/2010-04-01"


class TwilioError(RuntimeError):
    pass


class TwilioApi:
    def __init__(self, account_sid: str, auth_token: str, http: httpx.AsyncClient | None = None):
        if not account_sid or not auth_token:
            raise TwilioError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set")
        self.account_sid = account_sid
        self._auth = (account_sid, auth_token)
        self._http = http or httpx.AsyncClient(timeout=15)

    async def _post(self, path: str, data: dict) -> dict:
        url = f"{API}/Accounts/{self.account_sid}/{path}"
        resp = await self._http.post(url, data=data, auth=self._auth)
        if resp.status_code >= 400:
            try:
                body = resp.json()
                detail = f"{body.get('code')}: {body.get('message')}"
            except ValueError:
                detail = resp.text[:300]
            raise TwilioError(f"Twilio {path} failed ({resp.status_code}) {detail}")
        return resp.json()

    async def create_call(
        self,
        to: str,
        from_: str,
        twiml: str,
        status_callback: str | None = None,
        time_limit_s: int | None = None,
    ) -> str:
        data = {"To": to, "From": from_, "Twiml": twiml}
        if status_callback:
            data["StatusCallback"] = status_callback
            data["StatusCallbackEvent"] = "initiated ringing answered completed"
        if time_limit_s:
            data["TimeLimit"] = str(time_limit_s)
        result = await self._post("Calls.json", data)
        logger.info(f"Twilio call {result['sid']} created to {to}")
        return result["sid"]

    async def update_call_twiml(self, call_sid: str, twiml: str) -> None:
        await self._post(f"Calls/{call_sid}.json", {"Twiml": twiml})

    async def hang_up(self, call_sid: str) -> None:
        await self._post(f"Calls/{call_sid}.json", {"Status": "completed"})

    async def send_message(self, to: str, from_: str, body: str) -> str:
        result = await self._post("Messages.json", {"To": to, "From": from_, "Body": body})
        return result["sid"]


def stream_twiml(ws_url: str, parameters: dict[str, str]) -> str:
    """TwiML that connects the call audio to our WebSocket.

    Custom parameters arrive in the stream's 'start' message, which is how the
    WebSocket handler knows which agent and call this is.
    """
    params = "".join(f"<Parameter name={quoteattr(k)} value={quoteattr(v)} />" for k, v in parameters.items())
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Response><Connect><Stream url={quoteattr(ws_url)}>{params}</Stream></Connect></Response>"
    )


def dial_twiml(to_number: str, caller_id: str | None = None) -> str:
    attr = f" callerId={quoteattr(caller_id)}" if caller_id else ""
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><Response><Dial{attr}>{escape(to_number)}</Dial></Response>'
    )


def say_and_hangup_twiml(text: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<Response><Say voice="Google.he-IL-Standard-A" language="he-IL">{escape(text)}</Say>'
        "<Hangup/></Response>"
    )
