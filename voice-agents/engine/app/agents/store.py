"""Loads agent definitions. JSON files for now; the dashboard's database later."""

import json
from pathlib import Path

from app.agents.schema import AgentConfig


class AgentNotFound(KeyError):
    pass


class FileAgentStore:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def get(self, agent_id: str) -> AgentConfig:
        # The id pattern in AgentConfig forbids path separators, but the lookup
        # key comes from the outside, so check it before touching the filesystem.
        if not agent_id or "/" in agent_id or "\\" in agent_id or agent_id.startswith("."):
            raise AgentNotFound(agent_id)
        path = self.directory / f"{agent_id}.json"
        if not path.is_file():
            raise AgentNotFound(agent_id)
        agent = AgentConfig.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if agent.id != agent_id:
            raise ValueError(f"{path.name}: id {agent.id!r} does not match the file name")
        return agent

    def list(self) -> list[AgentConfig]:
        return [self.get(p.stem) for p in sorted(self.directory.glob("*.json"))]
