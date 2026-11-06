from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class PublicModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AgentInput(PublicModel):
    id: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    domain_id: str = Field(
        min_length=1,
        max_length=120,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
        validation_alias=AliasChoices("domainId", "domain_id"),
        serialization_alias="domainId",
    )
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class AgentView(AgentInput):
    created_at: datetime | str


class AgentList(PublicModel):
    items: tuple[AgentView, ...]


class RoundInput(PublicModel):
    id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1, validation_alias=AliasChoices("agentId", "agent_id"), serialization_alias="agentId")
    domain_id: str = Field(min_length=1, validation_alias=AliasChoices("domainId", "domain_id"), serialization_alias="domainId")
    objective: str = Field(min_length=1)


class CancelResponse(PublicModel):
    id: str
    cancellation_requested: bool


class ErrorResponse(PublicModel):
    code: str
    message: str | None = None


class SseEvent(PublicModel):
    id: int
    event: Literal["round-progress"]
    data: dict[str, object]