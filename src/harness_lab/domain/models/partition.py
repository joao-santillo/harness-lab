from __future__ import annotations

from typing import Literal

from . import DomainModel


class PartitionCase(DomainModel):
    id: str
    session_id: str
    similarity_group: str
    content: str


class PartitionManifest(DomainModel):
    version: Literal[1]
    seed: str
    diagnosis_ids: tuple[str, ...]
    reserved_ids: tuple[str, ...]
    created_at: str


class PartitionOptions(DomainModel):
    seed: str
    minimum_reserved: int
    reserved_ratio: float
    created_at: str | None = None
