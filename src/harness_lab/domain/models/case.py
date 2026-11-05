from __future__ import annotations

from typing import Literal

from .partition import PartitionCase
from .round import AgentId, CaseId, DomainId

CaseSource = Literal["manual", "json", "csv", "historical", "synthetic"]


class CaseRecord(PartitionCase):
    id: CaseId
    agent_id: AgentId
    domain_id: DomainId
    source: CaseSource
    source_reference: str | None = None
    synthetic_label: Literal["SYNTHETIC"] | None = None
    created_at: str
