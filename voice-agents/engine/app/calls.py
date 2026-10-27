"""State and record of one phone call: transcript, tool calls, outcome."""

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass
class TranscriptEntry:
    role: str  # "agent" | "caller"
    text: str
    at: str = field(default_factory=utc_now)


@dataclass
class ToolCallEntry:
    name: str
    arguments: dict[str, Any]
    ok: bool
    result: Any
    at: str = field(default_factory=utc_now)


@dataclass
class CallRecord:
    agent_id: str
    direction: str
    remote_number: str
    variables: dict[str, str] = field(default_factory=dict)
    id: str = field(default_factory=lambda: f"call_{uuid.uuid4().hex[:16]}")
    twilio_call_sid: str | None = None
    status: str = "created"  # created | ringing | in_progress | ended | failed | no_answer
    started_at: str | None = None
    ended_at: str | None = None
    end_reason: str | None = None
    transferred_to: str | None = None
    transcript: list[TranscriptEntry] = field(default_factory=list)
    tool_calls: list[ToolCallEntry] = field(default_factory=list)

    def add_transcript(self, role: str, text: str) -> None:
        text = text.strip()
        if text:
            self.transcript.append(TranscriptEntry(role=role, text=text))

    def add_tool_call(self, name: str, arguments: dict, ok: bool, result: Any) -> None:
        self.tool_calls.append(ToolCallEntry(name=name, arguments=arguments, ok=ok, result=result))

    def to_dict(self) -> dict:
        return asdict(self)


class CallRegistry:
    """Live calls in memory; finished calls written to disk as JSON.

    One process handles a call from start to end (the WebSocket stays on the
    instance that accepted it), so in-memory state is enough for live calls.
    """

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)
        self._live: dict[str, CallRecord] = {}

    def add(self, record: CallRecord) -> CallRecord:
        self._live[record.id] = record
        return record

    def get(self, call_id: str) -> CallRecord | None:
        if call_id in self._live:
            return self._live[call_id]
        path = self._path(call_id)
        if path and path.is_file():
            return _record_from_dict(json.loads(path.read_text(encoding="utf-8")))
        return None

    def find_by_sid(self, call_sid: str) -> CallRecord | None:
        return next((r for r in self._live.values() if r.twilio_call_sid == call_sid), None)

    def finish(self, record: CallRecord, status: str = "ended", reason: str | None = None) -> None:
        if record.ended_at:
            return
        record.status = status
        record.ended_at = utc_now()
        record.end_reason = record.end_reason or reason
        self.save(record)
        self._live.pop(record.id, None)

    def save(self, record: CallRecord) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self._path(record.id)
        assert path is not None
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(record.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def _path(self, call_id: str) -> Path | None:
        if not call_id.startswith("call_") or not call_id[5:].isalnum():
            return None
        return self.directory / f"{call_id}.json"


def _record_from_dict(data: dict) -> CallRecord:
    data = dict(data)
    data["transcript"] = [TranscriptEntry(**t) for t in data.get("transcript", [])]
    data["tool_calls"] = [ToolCallEntry(**t) for t in data.get("tool_calls", [])]
    return CallRecord(**data)
