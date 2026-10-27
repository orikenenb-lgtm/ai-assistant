"""Tools that act on the call itself or message the person on it."""

from typing import Any

from app.agents.schema import SendSmsTool, SendWhatsappTool, TransferCallTool
from app.telephony.phone import InvalidPhoneNumber, normalize_il_number
from app.telephony.twilio_api import dial_twiml
from app.tools.base import ToolContext, ToolError, ToolResult, ToolSpec

MAX_MESSAGE_CHARS = 1000


class EndCall:
    spec = ToolSpec(
        name="end_call",
        description="מסיים את השיחה. להשתמש רק אחרי שאמרת משפט פרידה.",
        properties={"reason": {"type": "string", "description": "למה השיחה הסתיימה, בכמה מילים"}},
    )

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        ctx.call.end_reason = args.get("reason") or "agent_ended"
        return ToolResult({"status": "ending"}, end_call=True)


def _require_twilio(ctx: ToolContext):
    if ctx.twilio is None:
        raise ToolError("שירות הטלפוניה לא מוגדר")
    return ctx.twilio


def _target_number(only_to_caller: bool, requested: str | None, ctx: ToolContext) -> str:
    if only_to_caller or not requested:
        if not ctx.call.remote_number or ctx.call.remote_number == "unknown":
            raise ToolError("המספר של הצד השני חסוי, אי אפשר לשלוח לו הודעה")
        return ctx.call.remote_number
    try:
        return normalize_il_number(requested)
    except InvalidPhoneNumber as e:
        raise ToolError("מספר הטלפון לא תקין") from e


def _message_args(only_to_caller: bool) -> tuple[dict, list[str]]:
    props: dict[str, Any] = {
        "message": {"type": "string", "description": "תוכן ההודעה, קצר וברור"},
    }
    if not only_to_caller:
        props["to"] = {"type": "string", "description": "מספר טלפון ישראלי. ריק = לצד השני בשיחה"}
    return props, ["message"]


class SendSms:
    def __init__(self, config: SendSmsTool):
        self.config = config
        props, required = _message_args(config.only_to_caller)
        self.spec = ToolSpec(
            name="send_sms",
            description="שולח SMS (למשל קישור, כתובת או סיכום). רק אחרי שהצד השני הסכים.",
            properties=props,
            required=required,
        )

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        twilio = _require_twilio(ctx)
        body = str(args.get("message", "")).strip()[:MAX_MESSAGE_CHARS]
        if not body:
            raise ToolError("ההודעה ריקה")
        to = _target_number(self.config.only_to_caller, args.get("to"), ctx)
        sid = await twilio.send_message(to=to, from_=ctx.settings.twilio_phone_number, body=body)
        return ToolResult({"status": "sent", "message_id": sid})


class SendWhatsapp:
    def __init__(self, config: SendWhatsappTool):
        self.config = config
        props, required = _message_args(config.only_to_caller)
        self.spec = ToolSpec(
            name="send_whatsapp",
            description="שולח הודעת WhatsApp. רק אחרי שהצד השני הסכים.",
            properties=props,
            required=required,
        )

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        twilio = _require_twilio(ctx)
        body = str(args.get("message", "")).strip()[:MAX_MESSAGE_CHARS]
        if not body:
            raise ToolError("ההודעה ריקה")
        to = _target_number(self.config.only_to_caller, args.get("to"), ctx)
        sender = self.config.from_number
        if not sender.startswith("whatsapp:"):
            sender = f"whatsapp:{sender}"
        sid = await twilio.send_message(to=f"whatsapp:{to}", from_=sender, body=body)
        return ToolResult({"status": "sent", "message_id": sid})


class TransferCall:
    def __init__(self, config: TransferCallTool):
        self.config = config
        self.spec = ToolSpec(
            name="transfer_call",
            description=(
                f"{config.description}. לפני השימוש להגיד שאת מעבירה אותם עכשיו. "
                "אחרי ההעברה השיחה איתך נגמרת."
            ),
        )

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        twilio = _require_twilio(ctx)
        if not ctx.call.twilio_call_sid:
            raise ToolError("אי אפשר להעביר את השיחה הזאת")
        try:
            target = normalize_il_number(self.config.to_number)
        except InvalidPhoneNumber as e:
            raise ToolError("מספר ההעברה לא מוגדר נכון") from e
        await twilio.update_call_twiml(
            ctx.call.twilio_call_sid,
            dial_twiml(target, caller_id=ctx.settings.twilio_phone_number or None),
        )
        ctx.call.transferred_to = target
        ctx.call.end_reason = "transferred"
        return ToolResult({"status": "transferred"}, transferred=True)
