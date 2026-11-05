from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from harness_lab.domain.models.harness import ExecutionId, ExecutionMetrics, ExecutionResult
from harness_lab.domain.ports import (
    BaselineExecutionRequest,
    CandidateExecutor,
    CandidateVersionExecutionRequest,
)

from .client import AgentPlatformClient


class AgentPlatformCandidateExecutor(CandidateExecutor):
    def __init__(
        self,
        client: AgentPlatformClient,
        *,
        delay: Callable[[int], Awaitable[None]] | None = None,
        poll_interval_ms: int = 500,
        max_polls: int = 20,
    ) -> None:
        self._client = client
        self._delay = delay or (lambda milliseconds: asyncio.sleep(milliseconds / 1_000))
        self._poll_interval_ms = poll_interval_ms
        self._max_polls = max_polls

    async def execute(
        self,
        request: BaselineExecutionRequest | CandidateVersionExecutionRequest,
    ) -> ExecutionResult:
        try:
            body: dict[str, Any] = {
                "environment": "test",
                "roundId": request.round_id,
                "caseId": request.case_id,
                "harnessVersionId": request.harness_version_id,
                "attempt": request.attempt,
                "correlationId": request.idempotency_key,
            }
            if request.kind == "candidate":
                body["candidateId"] = request.candidate_id

            response = await self._client.request(
                "/api/test/executions",
                method="POST",
                headers={
                    "content-type": "application/json",
                    "idempotency-key": request.idempotency_key,
                },
                json=body,
            )
            if not response.is_success:
                return self._failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED")

            payload: Any = response.json()
            if response.status_code == 202:
                if not isinstance(payload, dict) or payload.get("status") != "accepted" or not isinstance(payload.get("jobId"), str):
                    return self._failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED")
                job_id = payload["jobId"]
                for _ in range(self._max_polls):
                    await self._delay(self._poll_interval_ms)
                    job_response = await self._client.request(f"/api/test/executions/{job_id}")
                    if not job_response.is_success:
                        return self._failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED")
                    payload = job_response.json()
                    if not (
                        isinstance(payload, dict)
                        and isinstance(payload.get("status"), str)
                        and payload["status"] in {"accepted", "running"}
                    ):
                        return self._result(request, payload)
                return self._failure(request, "timed_out", "AGENT_PLATFORM_JOB_TIMEOUT")

            return self._result(request, payload)
        except Exception:
            return self._failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED")

    def _result(
        self,
        request: BaselineExecutionRequest | CandidateVersionExecutionRequest,
        remote: Any,
    ) -> ExecutionResult:
        if not isinstance(remote, dict):
            return self._failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED")

        status_value = remote.get("status")
        trace_id = remote.get("traceId") if isinstance(remote.get("traceId"), str) or remote.get("traceId") is None else None
        output = remote.get("output") if isinstance(remote.get("output"), str) or remote.get("output") is None else None
        metrics = remote.get("metrics") if isinstance(remote.get("metrics"), dict) else {}
        latency_ms = metrics.get("latencyMs") if isinstance(metrics.get("latencyMs"), int) else 0
        input_tokens = metrics.get("inputTokens") if isinstance(metrics.get("inputTokens"), int) else None
        output_tokens = metrics.get("outputTokens") if isinstance(metrics.get("outputTokens"), int) else None
        cost = metrics.get("cost") if isinstance(metrics.get("cost"), (int, float)) else None

        if status_value == "completed":
            status = "trace_missing" if trace_id is None else "succeeded"
        elif status_value == "failed":
            status = "agent_failed"
        elif status_value == "cancelled":
            status = "cancelled"
        else:
            return self._failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED")

        limitations = (
            ("TRACE_CORRELATION_PENDING",)
            if status_value == "completed" and trace_id is None
            else ()
        )
        execution_id = remote.get("executionId")
        if not isinstance(execution_id, str):
            execution_id = f"{request.idempotency_key}:{status}"
        return ExecutionResult(
            id=ExecutionId(execution_id),
            round_id=request.round_id,
            case_id=request.case_id,
            harness_snapshot_id=request.harness_version_id,
            status=status,
            correlation_id=request.idempotency_key,
            trace_id=trace_id,
            output=output,
            metrics=ExecutionMetrics(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost=cost,
                latency_ms=latency_ms,
            ),
            limitations=limitations,
        )

    def _failure(
        self,
        request: BaselineExecutionRequest | CandidateVersionExecutionRequest,
        status: str,
        limitation: str,
    ) -> ExecutionResult:
        return ExecutionResult(
            id=ExecutionId(f"{request.idempotency_key}:{status}"),
            round_id=request.round_id,
            case_id=request.case_id,
            harness_snapshot_id=request.harness_version_id,
            status=status,
            correlation_id=request.idempotency_key,
            trace_id=None,
            output=None,
            metrics=ExecutionMetrics(
                input_tokens=None,
                output_tokens=None,
                cost=None,
                latency_ms=0,
            ),
            limitations=(limitation,),
        )
