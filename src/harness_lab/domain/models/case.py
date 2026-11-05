from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from .partition import PartitionCase
from .round import AgentId, CaseId, DomainId

CaseSource = Literal["manual", "json", "csv", "historical", "synthetic"]


class CaseRecord(PartitionCase):
    id: CaseId
    agent_id: AgentId
    domain_id: DomainId
    source: CaseSource
    source_reference: str | None = Field(default=None, exclude_if=lambda value: value is None)
    synthetic_label: Literal["SYNTHETIC"] | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    created_at: str

    @field_validator("source_reference", "synthetic_label", mode="before")
    @classmethod
    def _reject_explicit_null_on_omissible_fields(cls, value: object) -> object:
        if value is None:
            raise ValueError("field must be omitted instead of null")
        return value
