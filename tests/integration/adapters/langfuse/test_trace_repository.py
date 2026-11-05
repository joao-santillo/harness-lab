from __future__ import annotations

import asyncio

import httpx

from harness_lab.adapters.langfuse.client import LangfuseClient
from harness_lab.adapters.langfuse.trace_repository import LangfuseTraceRepository
from harness_lab.domain.ports import TraceQuery


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def test_trace_repository_collects_v2_with_retry_and_bounds() -> None:
    attempts = {"count": 0}
    delays: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        assert request.url.params.get("fromStartTime") == "2026-10-01T00:00:00Z"
        assert request.url.params.get("toStartTime") == "2026-10-31T00:00:00Z"
        if attempts["count"] == 1:
            return httpx.Response(429, headers={"retry-after": "1"}, json={})
        page = int(request.url.params.get("page", "1"))
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": f"obs-{page}",
                        "traceId": f"trace-{page}",
                        "parentObservationId": None,
                        "type": "SPAN",
                        "input": "in",
                        "output": "out",
                        "startTime": "2026-10-01T00:00:00Z",
                        "endTime": "2026-10-01T00:00:01Z",
                        "usageDetails": {"input": 1},
                        "costDetails": {"usd": 0.01},
                    }
                ],
                "meta": {"page": page, "totalPages": 2},
            },
        )

    repository = LangfuseTraceRepository(
        client=LangfuseClient(
            base_url="https://langfuse.example",
            public_key="pk",
            secret_key="sk",
            transport=httpx.MockTransport(handler),
        ),
        project_id="project-1",
        observations_api="v2",
        delay=lambda milliseconds: _run(asyncio.sleep(milliseconds / 1000.0)) if False else asyncio.sleep(0),
    )

    page = _run(
        repository.collect(
            TraceQuery(
                round_id="round-1",
                agent_id="agent-1",
                **{
                    "from": "2026-10-01T00:00:00Z",
                    "to": "2026-10-31T00:00:00Z",
                    "cursor": "1",
                    "limit": 2,
                },
            )
        )
    )
    assert len(page.evidence) == 2
    assert page.next_cursor is None
    assert attempts["count"] == 3
    _ = delays


def test_trace_repository_uses_legacy_only_when_selected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/public/traces"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "trace-1",
                        "input": "in",
                        "output": "out",
                        "timestamp": "2026-10-01T00:00:00Z",
                    }
                ],
                "meta": {"page": 1, "totalPages": 1},
            },
        )

    repository = LangfuseTraceRepository(
        client=LangfuseClient(
            base_url="https://langfuse.example",
            public_key="pk",
            secret_key="sk",
            transport=httpx.MockTransport(handler),
        ),
        project_id="project-1",
        observations_api="legacy",
    )
    page = _run(
        repository.collect(
            TraceQuery(
                round_id="round-1",
                agent_id="agent-1",
                **{"from": "from", "to": "to", "cursor": None, "limit": 1},
            )
        )
    )
    assert len(page.evidence) == 1
