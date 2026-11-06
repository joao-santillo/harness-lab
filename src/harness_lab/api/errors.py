from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ApiError(Exception):
    status_code: int
    code: str
    message: str | None = None

    def __str__(self) -> str:
        return self.message or self.code