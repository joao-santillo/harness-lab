from __future__ import annotations

import asyncio

import httpx
import pytest

from harness_lab.adapters.langfuse.case_import_repository import (
    LangfuseCaseImportRepository,
    LangfuseImportPreviewStore,
    langfuse_case_id,
)
from harness_lab.adapters.langfuse.client import LangfuseClient

FROM_START = "2026-10-01T00:00:00.000Z"
TO_START = "2026-10-02T00:00:00.000Z"


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def _repository(
    handler: httpx.MockTransport,
    *,
    observations_api: str = "v2",
    delay: None | callable = None,
) -> LangfuseCaseImportRepository:
    return LangfuseCaseImportRepository(
        client=LangfuseClient(
            base_url="https://langfuse.example",
            public_key="pk",
            secret_key="sk-secret",
            transport=handler,
        ),
        observations_api=observations_api,
        source_reference_prefix="langfuse:connection-1:",
        delay=delay,
    )


def test_case_import_classifies_trace_items() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/public/v2/observations"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "ready-root",
                        "traceId": "ready",
                        "isRootObservation": True,
                        "startTime": FROM_START,
                        "input": {"prompt": "hello"},
                    },
                    {
                        "id": "empty-root",
                        "traceId": "missing-input",
                        "isRootObservation": True,
                        "startTime": FROM_START,
                        "input": None,
                    },
                    {
                        "id": "orphan",
                        "traceId": "missing-root",
                        "isRootObservation": False,
                        "parentObservationId": "parent",
                        "startTime": FROM_START,
                        "input": "orphan",
                    },
                ],
                "meta": {},
            },
        )

    result = _run(
        _repository(httpx.MockTransport(handler)).import_cases(
            from_start_time=FROM_START,
            to_start_time=TO_START,
            limit=3,
        )
    )
    assert len(result.items) == 3
    assert any(item.status == "ready" and item.trace_id == "ready" for item in result.items)
    assert any(
        item.status == "discarded" and item.trace_id == "missing-input" and item.reason == "MISSING_USABLE_INPUT"
        for item in result.items
    )
    assert any(
        item.status == "discarded" and item.trace_id == "missing-root" and item.reason == "MISSING_ROOT"
        for item in result.items
    )


def test_case_import_rejects_malformed_typed_optional_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/public/v2/observations"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "obs-1",
                        "traceId": "trace-invalid-typed",
                        "isRootObservation": "yes",
                        "sessionId": 123,
                        "startTime": FROM_START,
                        "input": {"prompt": "hello"},
                    }
                ],
                "meta": {},
            },
        )

    with pytest.raises(RuntimeError, match="LANGFUSE_CASE_IMPORT_FAILED"):
        _run(
            _repository(httpx.MockTransport(handler)).import_cases(
                from_start_time=FROM_START,
                to_start_time=TO_START,
                limit=1,
            )
        )


def test_case_import_retries_once_on_429_then_sanitizes_rate_limit() -> None:
    attempts = {"count": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        return httpx.Response(429, headers={"retry-after": "0"}, text="secret")

    repository = _repository(
        httpx.MockTransport(handler),
        delay=lambda _milliseconds: asyncio.sleep(0),
    )
    with pytest.raises(RuntimeError, match="LANGFUSE_RATE_LIMITED"):
        _run(repository.import_cases(from_start_time=FROM_START, to_start_time=TO_START, limit=1))
    assert attempts["count"] == 2


def test_case_import_detects_repeated_cursor() -> None:
    calls = {"count": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "root",
                            "traceId": "trace-1",
                            "isRootObservation": True,
                            "startTime": FROM_START,
                            "input": "usable",
                        }
                    ],
                    "meta": {"cursor": "same"},
                },
            )
        return httpx.Response(200, json={"data": [], "meta": {"cursor": "same"}})

    result = _run(
        _repository(httpx.MockTransport(handler)).import_cases(
            from_start_time=FROM_START,
            to_start_time=TO_START,
            limit=5,
        )
    )
    assert "Langfuse returned a repeated cursor; pagination stopped." in result.limitations


def test_case_import_legacy_mode_reports_deprecation() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/public/traces"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "legacy-trace",
                        "input": {"prompt": "hello"},
                        "timestamp": FROM_START,
                        "sessionId": "legacy-session",
                        "name": "legacy-name",
                    }
                ],
                "meta": {"page": 1, "totalPages": 1},
            },
        )

    result = _run(
        _repository(httpx.MockTransport(handler), observations_api="legacy").import_cases(
            from_start_time=FROM_START,
            to_start_time=TO_START,
            limit=2,
        )
    )
    assert result.limitations == ("Langfuse legacy trace endpoint is deprecated.",)
    ready = next(item for item in result.items if item.status == "ready")
    assert ready.candidate is not None
    assert ready.candidate.content == '{"prompt":"hello"}'


def test_langfuse_case_id_is_stable_sha256_prefix() -> None:
    case_id = langfuse_case_id("connection-1", "trace-1")
    assert case_id.startswith("langfuse-")
    assert len(case_id) == len("langfuse-") + 64


def _candidate(trace_id: str) -> dict[str, str]:
    return {
        "trace_id": trace_id,
        "session_id": f"session-{trace_id}",
        "similarity_group": "flow",
        "content": f"content-{trace_id}",
        "start_time": "2026-11-04T15:00:00.000Z",
    }


def test_preview_store_consumes_once_and_keeps_content_server_side() -> None:
    now = {"value": 1762268400000}
    store = LangfuseImportPreviewStore(now=lambda: now["value"], create_id=lambda: "preview-1")
    preview = store.create(
        agent_id="agent",
        domain_id="domain",
        connection_id="connection",
        ready=(
            _candidate("trace-a"),
            _candidate("trace-b"),
        ),
    )
    assert preview["preview_id"] == "preview-1"
    consumed = store.consume("preview-1", ("trace-b",))
    assert consumed["candidates"][0]["trace_id"] == "trace-b"
    with pytest.raises(RuntimeError, match="PREVIEW_EXPIRED"):
        store.consume("preview-1", ("trace-b",))


def test_preview_store_rejects_invalid_selection_without_consuming() -> None:
    store = LangfuseImportPreviewStore(create_id=lambda: "preview-selection")
    store.create(
        agent_id="agent",
        domain_id="domain",
        connection_id="connection",
        ready=(_candidate("trace-a"), _candidate("trace-b")),
    )
    with pytest.raises(RuntimeError, match="PREVIEW_SELECTION_INVALID"):
        store.consume("preview-selection", ())
    consumed = store.consume("preview-selection", ("trace-a",))
    assert consumed["candidates"][0]["trace_id"] == "trace-a"
