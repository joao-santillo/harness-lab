from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from .redactor import create_redactor

_RESERVED_DENY_KEYS = {
    "credential",
    "credentials",
    "trace",
    "input",
    "prompt",
    "opaquepayload",
    "opaque_payload",
}


class SafeLogger:
    def __init__(
        self,
        sink: Callable[[dict[str, object]], None],
        allowlist_fields: Sequence[str] = (),
        secret_values: Sequence[str] = (),
    ) -> None:
        self._sink = sink
        self._allowlist = tuple(allowlist_fields)
        self._allowset = {field for field in allowlist_fields}
        self._redact = create_redactor(list(secret_values))

    def emit(
        self,
        *,
        event: str,
        code: str,
        correlation_id: str | None = None,
        fields: Mapping[str, Any] | None = None,
    ) -> None:
        payload: dict[str, object] = {"event": event, "code": code}
        if correlation_id is not None:
            payload["correlationId"] = correlation_id
        if fields is not None:
            for key in self._allowlist:
                normalized = key.replace("_", "").lower()
                if normalized in _RESERVED_DENY_KEYS:
                    continue
                if key in self._allowset and key in fields:
                    payload[key] = self._redact(fields[key])
        self._sink(payload)
