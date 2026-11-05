from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


def to_camel(field_name: str) -> str:
    parts = field_name.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


class DomainModel(BaseModel):
    model_config = ConfigDict(
        frozen=True,
        populate_by_name=True,
        alias_generator=to_camel,
        extra="forbid",
    )


JsonObject = dict[str, Any]
