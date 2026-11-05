from __future__ import annotations

import asyncio

import httpx
import pytest

from harness_lab.adapters.langfuse.capabilities import negotiate_langfuse_capabilities
from harness_lab.adapters.langfuse.client import LangfuseClient


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def _client_with_status(status: int) -> LangfuseClient:
    def handler(request: httpx.Request) -> httpx.Response:
        is_legacy = request.url.path == "/api/public/traces"
        legacy_status = 200 if is_legacy and status in (404, 405) else status
        return httpx.Response(
            legacy_status,
            json={"data": [], "meta": {"page": 1, "totalPages": 1}},
            headers={"content-type": "application/json"},
        )

    return LangfuseClient(
        base_url="https://langfuse.example",
        public_key="pk",
        secret_key="sk",
        transport=httpx.MockTransport(handler),
    )


def test_negotiate_capabilities_prefers_v2() -> None:
    result = _run(
        negotiate_langfuse_capabilities(
            _client_with_status(200),
            now=lambda: "2026-10-31T00:00:00.000Z",
        )
    )
    assert result.observations_api == "v2"
    assert result.scores_api == "v3"
    assert result.limitations == ()


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (404, "Observations v2 probe returned 404; using deprecated legacy trace reads."),
        (405, "Observations v2 is unavailable; using deprecated legacy trace reads."),
    ],
)
def test_negotiate_capabilities_falls_back_to_legacy(status: int, message: str) -> None:
    result = _run(
        negotiate_langfuse_capabilities(
            _client_with_status(status),
            now=lambda: "2026-10-31T00:00:00.000Z",
        )
    )
    assert result.observations_api == "legacy"
    assert result.supported_filters == ("fromTimestamp", "toTimestamp")
    assert result.limitations == (message,)


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "LANGFUSE_INVALID_CREDENTIALS"),
        (403, "LANGFUSE_INVALID_CREDENTIALS"),
        (429, "LANGFUSE_RATE_LIMITED"),
    ],
)
def test_negotiate_capabilities_raises_stable_errors(status: int, code: str) -> None:
    with pytest.raises(RuntimeError, match=code):
        _run(negotiate_langfuse_capabilities(_client_with_status(status)))
