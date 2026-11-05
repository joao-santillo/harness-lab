from __future__ import annotations

from harness_lab.adapters.security.safe_logging import SafeLogger


class _Sink:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    def __call__(self, payload: dict[str, object]) -> None:
        self.events.append(payload)


def test_safe_logger_redacts_and_omits_non_allowlisted_sensitive_fields() -> None:
    sink = _Sink()
    logger = SafeLogger(
        sink=sink,
        allowlist_fields=("status", "error", "meta"),
        secret_values=("sk_sentinel_123",),
    )

    err = RuntimeError("failed using sk_sentinel_123")
    err.cause = ValueError("trace=input prompt=raw")  # type: ignore[attr-defined]

    logger.emit(
        event="connection.failed",
        code="CONNECTION_FAILED",
        correlation_id="corr-1",
        fields={
            "status": "failed",
            "error": err,
            "meta": {"url": "https://user:pass@example.com/?token=abc", "authorization": "Bearer abc"},
            "credentials": {"secretKey": "sk_sentinel_123"},
            "trace": "trace=input",
            "input": "prompt",
            "prompt": "raw",
            "opaquePayload": {"secret": "x"},
        },
    )

    assert len(sink.events) == 1
    payload = sink.events[0]
    text = str(payload)
    assert payload["event"] == "connection.failed"
    assert payload["code"] == "CONNECTION_FAILED"
    assert payload["correlationId"] == "corr-1"
    assert "credentials" not in payload
    assert "trace" not in payload
    assert "input" not in payload
    assert "prompt" not in payload
    assert "opaquePayload" not in payload
    assert "sk_sentinel_123" not in text
    assert "Bearer abc" not in text
    assert "token=abc" not in text
