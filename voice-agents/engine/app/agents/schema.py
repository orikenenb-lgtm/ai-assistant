"""The definition of a voice agent: who she is, how the call goes and what she may do."""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


class Situation(BaseModel):
    when: str
    do: str


class Step(BaseModel):
    name: str
    purpose: str
    say: str | None = None
    ask: str | None = None
    situations: list[Situation] = Field(default_factory=list)


class Rule(BaseModel):
    mode: Literal["always", "never"]
    text: str


class KnowledgeItem(BaseModel):
    title: str
    body: str


class Variable(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    description: str = ""
    example: str = ""
    required: bool = False


class Limits(BaseModel):
    max_duration_s: int = Field(default=600, ge=60, le=3600)
    # When to start wrapping up; None = 80% of max_duration_s.
    wrap_up_at_s: int | None = None

    @property
    def effective_wrap_up_s(self) -> int:
        return self.wrap_up_at_s or int(self.max_duration_s * 0.8)


# --- Tools -------------------------------------------------------------------
# Every tool an agent may use is listed explicitly in its definition. Nothing is
# enabled by default except end_call, so an agent can never do more than its owner set.


class EndCallTool(BaseModel):
    type: Literal["end_call"] = "end_call"


class SendSmsTool(BaseModel):
    type: Literal["send_sms"] = "send_sms"
    # Only send to the person on the call (the safe default), or to any number.
    only_to_caller: bool = True


class SendWhatsappTool(BaseModel):
    type: Literal["send_whatsapp"] = "send_whatsapp"
    # Twilio WhatsApp sender, e.g. "whatsapp:+14155238886".
    from_number: str
    only_to_caller: bool = True


class TransferCallTool(BaseModel):
    type: Literal["transfer_call"] = "transfer_call"
    # Where to transfer, e.g. the business owner's mobile.
    to_number: str
    description: str = "להעביר את השיחה לנציג אנושי"


class WebhookParam(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z_][a-zA-Z0-9_]{0,39}$")
    type: Literal["string", "number", "integer", "boolean"] = "string"
    description: str = ""
    required: bool = False


class WebhookTool(BaseModel):
    """Any HTTP endpoint of the business, exposed to the agent as a tool."""

    type: Literal["webhook"] = "webhook"
    name: str = Field(pattern=r"^[a-zA-Z_][a-zA-Z0-9_]{0,39}$")
    description: str
    url: HttpUrl
    method: Literal["GET", "POST"] = "POST"
    params: list[WebhookParam] = Field(default_factory=list)
    # Extra headers (e.g. Authorization). Values may reference env vars as ${NAME}.
    headers: dict[str, str] = Field(default_factory=dict)
    timeout_s: float = Field(default=10, gt=0, le=30)

    @field_validator("url")
    @classmethod
    def https_only(cls, url: HttpUrl) -> HttpUrl:
        if url.scheme != "https":
            raise ValueError("webhook url must be https")
        return url


class McpServerTool(BaseModel):
    """Every tool of a remote MCP server (Streamable HTTP), optionally filtered."""

    type: Literal["mcp"] = "mcp"
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,19}$")
    url: HttpUrl
    headers: dict[str, str] = Field(default_factory=dict)
    # If set, only these tool names are exposed to the agent.
    allow: list[str] | None = None


class MorningDocumentTool(BaseModel):
    """Issue documents (price quote, invoice...) through Morning / Green Invoice."""

    type: Literal["morning_document"] = "morning_document"
    # Document types the agent may issue. Default: price quotes only. A receipt needs a
    # payment, which a phone agent never takes, so receipts are not offered.
    allowed_types: list[Literal["price_quote", "order", "tax_invoice"]] = ["price_quote"]
    # Hard cap on a single document's total (ILS, including VAT).
    max_total_ils: float = Field(default=5000, gt=0)


ToolConfig = Annotated[
    EndCallTool
    | SendSmsTool
    | SendWhatsappTool
    | TransferCallTool
    | WebhookTool
    | McpServerTool
    | MorningDocumentTool,
    Field(discriminator="type"),
]


class AgentConfig(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,47}$")
    name: str
    business_name: str = ""
    language: str = "he"
    # Hebrew is gendered: the agent speaks about herself (or himself) in this form.
    agent_gender: Literal["female", "male"] = "female"
    voice_id: str | None = None
    llm_model: str | None = None

    context: str
    goal: str
    opening_line: str = ""
    outbound_opening: str = ""
    steps: list[Step] = Field(default_factory=list)
    rules: list[Rule] = Field(default_factory=list)
    knowledge: list[KnowledgeItem] = Field(default_factory=list)
    variables: list[Variable] = Field(default_factory=list)
    tools: list[ToolConfig] = Field(default_factory=lambda: [EndCallTool()])
    limits: Limits = Field(default_factory=Limits)

    @field_validator("tools")
    @classmethod
    def always_end_call(cls, tools: list) -> list:
        if not any(isinstance(t, EndCallTool) for t in tools):
            tools = [EndCallTool(), *tools]
        return tools

    def unfilled_placeholders(self) -> list[str]:
        """Fields still holding '[למלא: ...]' templates. Such an agent must not take calls:
        she would read the template out loud or dial a non-number."""
        return re.findall(r"\[למלא:?[^\]]*\]", self.model_dump_json())
