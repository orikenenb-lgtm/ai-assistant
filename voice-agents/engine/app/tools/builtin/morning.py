"""Issues business documents (price quote, order, tax invoice) through Morning / Green Invoice.

API reference: https://www.greeninvoice.co.il/api-docs
"""

import time
from typing import Any

import httpx
from loguru import logger

from app.agents.schema import MorningDocumentTool
from app.tools.base import ToolContext, ToolError, ToolResult, ToolSpec

PRODUCTION_API = "https://api.greeninvoice.co.il/api/v1"
SANDBOX_API = "https://sandbox.d.greeninvoice.co.il/api/v1"

DOCUMENT_TYPES = {"price_quote": 10, "order": 100, "tax_invoice": 305}
DOCUMENT_NAMES = {"price_quote": "הצעת מחיר", "order": "הזמנה", "tax_invoice": "חשבונית מס"}
# Item prices are given to the agent and read to the caller including VAT.
VAT_INCLUDED = 1


class MorningClient:
    def __init__(self, key_id: str, key_secret: str, sandbox: bool, http: httpx.AsyncClient):
        if not key_id or not key_secret:
            raise ToolError("חשבון Morning לא מחובר")
        self.base = SANDBOX_API if sandbox else PRODUCTION_API
        self._creds = {"id": key_id, "secret": key_secret}
        self._http = http
        self._token: str | None = None
        self._token_expires = 0.0

    async def _auth_header(self) -> dict[str, str]:
        if not self._token or time.time() > self._token_expires - 60:
            resp = await self._http.post(f"{self.base}/account/token", json=self._creds, timeout=15)
            if resp.status_code >= 400:
                logger.error(f"Morning auth failed: {resp.status_code} {resp.text[:200]}")
                raise ToolError("ההתחברות ל-Morning נכשלה")
            body = resp.json()
            self._token = body["token"]
            # 'expires' is a unix timestamp; fall back to a short lifetime if it's missing.
            self._token_expires = float(body.get("expires") or time.time() + 600)
        return {"Authorization": f"Bearer {self._token}"}

    async def create_document(self, payload: dict) -> dict:
        resp = await self._http.post(
            f"{self.base}/documents", json=payload, headers=await self._auth_header(), timeout=20
        )
        if resp.status_code >= 400:
            logger.error(f"Morning document failed: {resp.status_code} {resp.text[:300]}")
            try:
                message = resp.json().get("errorMessage") or ""
            except ValueError:
                message = ""
            raise ToolError(f"Morning לא הוציאה את המסמך. {message}".strip())
        return resp.json()


class MorningDocument:
    def __init__(self, config: MorningDocumentTool, client_factory=None):
        self.config = config
        self._client_factory = client_factory
        self._client: MorningClient | None = None
        names = ", ".join(f"{t} ({DOCUMENT_NAMES[t]})" for t in config.allowed_types)
        self.spec = ToolSpec(
            name="issue_document",
            description=(
                f"מפיק מסמך עסקי ב-Morning. סוגים מותרים: {names}. "
                "לפני השימוש לחזור על הפריטים, הכמויות, המחירים והשם, ולקבל אישור מפורש. "
                'המחירים כוללים מע"מ. מחזיר קישור למסמך שאפשר לשלוח ב-SMS או WhatsApp.'
            ),
            properties={
                "document_type": {"type": "string", "enum": list(config.allowed_types)},
                "client_name": {"type": "string", "description": "השם על המסמך"},
                "client_email": {"type": "string", "description": "מייל לשליחת המסמך, אם נמסר"},
                "client_phone": {"type": "string"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "quantity": {"type": "number"},
                            "unit_price": {"type": "number", "description": 'מחיר ליחידה כולל מע"מ'},
                        },
                        "required": ["description", "quantity", "unit_price"],
                    },
                },
                "remarks": {"type": "string"},
                "caller_confirmed": {
                    "type": "boolean",
                    "description": "true רק אם הצד השני אישר במפורש את כל הפרטים",
                },
            },
            required=["document_type", "client_name", "items", "caller_confirmed"],
        )

    def _get_client(self, ctx: ToolContext) -> MorningClient:
        if self._client is None:
            factory = self._client_factory or (
                lambda: MorningClient(
                    ctx.settings.morning_api_key_id,
                    ctx.settings.morning_api_key_secret,
                    ctx.settings.morning_sandbox,
                    ctx.http,
                )
            )
            self._client = factory()
        return self._client

    def build_payload(self, args: dict[str, Any]) -> tuple[dict, float]:
        if args.get("caller_confirmed") is not True:
            raise ToolError("קודם צריך לחזור על הפרטים ולקבל אישור מפורש")
        doc_type = args.get("document_type")
        if doc_type not in self.config.allowed_types:
            raise ToolError("אין לי הרשאה להפיק מסמך מהסוג הזה")
        name = str(args.get("client_name") or "").strip()
        if not name:
            raise ToolError("חסר שם למסמך")
        items = args.get("items") or []
        if not items or len(items) > 50:
            raise ToolError("רשימת הפריטים ריקה או ארוכה מדי")
        income, total = [], 0.0
        for item in items:
            try:
                qty = float(item["quantity"])
                price = float(item["unit_price"])
                desc = str(item["description"]).strip()
            except (KeyError, TypeError, ValueError) as e:
                raise ToolError("אחד הפריטים לא שלם") from e
            if qty <= 0 or price < 0 or not desc:
                raise ToolError("כמות או מחיר לא תקינים")
            total += qty * price
            income.append(
                {
                    "description": desc[:200],
                    "quantity": qty,
                    "price": round(price, 2),
                    "currency": "ILS",
                    "vatType": VAT_INCLUDED,
                }
            )
        total = round(total, 2)
        if total > self.config.max_total_ils:
            raise ToolError("הסכום גבוה מהמותר לי. בעל העסק יחזור אליהם")
        client: dict[str, Any] = {"name": name[:100], "add": False}
        if args.get("client_email"):
            client["emails"] = [str(args["client_email"]).strip()]
        if args.get("client_phone"):
            client["phone"] = str(args["client_phone"]).strip()
        payload = {
            "type": DOCUMENT_TYPES[doc_type],
            "lang": "he",
            "currency": "ILS",
            "client": client,
            "income": income,
            "remarks": str(args.get("remarks") or "")[:500],
        }
        return payload, total

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        payload, total = self.build_payload(args)
        if ctx.test_mode and not ctx.settings.morning_sandbox:
            # Never issue a real tax document from a test conversation.
            return ToolResult(
                {
                    "status": "simulated",
                    "document_type": DOCUMENT_NAMES[args["document_type"]],
                    "total_ils": total,
                    "link": "https://example.invalid/test-document",
                }
            )
        doc = await self._get_client(ctx).create_document(payload)
        url = doc.get("url")
        link = (url.get("he") or url.get("origin")) if isinstance(url, dict) else url
        return ToolResult(
            {
                "status": "issued",
                "document_type": DOCUMENT_NAMES[args["document_type"]],
                "number": doc.get("number"),
                "total_ils": total,
                "link": link,
            }
        )
