from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

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
    created_at: str | None = Field(default=None, exclude_if=lambda value: value is None)

    @field_validator("created_at", mode="before")
    @classmethod
    def _reject_explicit_null_on_omissible_field(cls, value: object) -> object:
        if value is None:
            raise ValueError("field must be omitted instead of null")
        return value
