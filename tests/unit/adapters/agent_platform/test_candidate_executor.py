from __future__ import annotations

import asyncio

import httpx

from harness_lab.adapters.agent_platform.candidate_executor import AgentPlatformCandidateExecutor
from harness_lab.adapters.agent_platform.client import AgentPlatformClient
from harness_lab.domain.ports import parse_candidate_execution_request


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


REQUEST = parse_candidate_execution_request(
    {
        "kind": "candidate",
        "roundId": "round-1",
        "caseId": "case-1",
        "harnessVersionId": "version-1",
        "candidateId": "candidate-1",
        "attempt": 1,
        "idempotencyKey": "round-1:case-1:candidate-1",
    }
)


def test_executor_returns_sync_success_without_publish_field() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read().decode("utf-8")
        assert '"publish"' not in body
        assert request.headers.get("idempotency-key") == REQUEST.idempotency_key
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "executionId": "exec-1",
                "traceId": "trace-1",
                "output": "ok",
                "metrics": {
                    "latencyMs": 12,
                    "inputTokens": 2,
                    "outputTokens": 3,
                    "cost": 0.01,
                },
            },
        )

    executor = AgentPlatformCandidateExecutor(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(handler),
        )
    )
    result = _run(executor.execute(REQUEST))
    assert result.status == "succeeded"
    assert result.trace_id == "trace-1"
    assert result.correlation_id == REQUEST.idempotency_key


def test_executor_polls_accepted_job_and_marks_missing_trace() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if request.url.path.endswith("/executions"):
            return httpx.Response(202, json={"status": "accepted", "jobId": "job-1"})
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "executionId": "exec-1",
                "traceId": None,
                "output": "ok",
                "metrics": {"latencyMs": 5},
            },
        )

    executor = AgentPlatformCandidateExecutor(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(handler),
        ),
        delay=lambda _milliseconds: asyncio.sleep(0),
        max_polls=2,
    )
    result = _run(executor.execute(REQUEST))
    assert calls["count"] == 2
    assert result.status == "trace_missing"


def test_executor_maps_failed_cancelled_and_timeout() -> None:
    failed_executor = AgentPlatformCandidateExecutor(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={
                        "status": "failed",
                        "executionId": "exec-1",
                        "traceId": None,
                        "output": None,
                        "metrics": {"latencyMs": 1},
                    },
                )
            ),
        )
    )
    assert _run(failed_executor.execute(REQUEST)).status == "agent_failed"

    cancelled_executor = AgentPlatformCandidateExecutor(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={
                        "status": "cancelled",
                        "executionId": "exec-1",
                        "traceId": None,
                        "output": None,
                        "metrics": {"latencyMs": 1},
                    },
                )
            ),
        )
    )
    assert _run(cancelled_executor.execute(REQUEST)).status == "cancelled"

    timeout_executor = AgentPlatformCandidateExecutor(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(202, json={"status": "accepted", "jobId": "job-1"})
                if request.url.path.endswith("/executions")
                else httpx.Response(200, json={"status": "running"})
            ),
        ),
        delay=lambda _milliseconds: asyncio.sleep(0),
        max_polls=2,
    )
    assert _run(timeout_executor.execute(REQUEST)).status == "timed_out"


def test_executor_sanitizes_remote_failures() -> None:
    executor = AgentPlatformCandidateExecutor(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(500, json={"message": "secret remote detail"})
            ),
        )
    )
    result = _run(executor.execute(REQUEST))
    assert result.status == "integration_failed"
    assert "secret remote detail" not in " ".join(result.limitations)
