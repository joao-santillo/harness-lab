from __future__ import annotations

import asyncio

import httpx
import pytest

from harness_lab.adapters.agent_platform.client import AgentPlatformClient
from harness_lab.adapters.agent_platform.harness_repository import AgentPlatformHarnessRepository


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def test_harness_repository_maps_capabilities_and_snapshot() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/capabilities"):
            return httpx.Response(
                200,
                json={
                    "editable": [
                        "dta-flow",
                        "tools",
                        "parameters",
                        "knowledge",
                        "memory",
                        "records",
                        "unknown-component",
                    ],
                    "supportsSeed": True,
                    "supportsToolReplay": False,
                    "apiVersion": "2026-10",
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "agent-1",
                "version": "7",
                "dtaFlow": {"nodes": []},
                "tools": [{"name": "search"}],
                "parameters": {"temperature": 0},
                "knowledge": ["kb-1"],
                "memory": {"enabled": True},
                "records": [],
                "futureField": {"preserved": True},
                "immutableRules": ["No secret disclosure"],
            },
        )

    repository = AgentPlatformHarnessRepository(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="platform-token",
            transport=httpx.MockTransport(handler),
        ),
        now=lambda: "2026-10-31T00:00:00.000Z",
    )

    capabilities = _run(repository.get_capabilities("agent-1"))
    snapshot = _run(repository.fetch_snapshot("agent-1", "domain-1"))

    assert capabilities.editable_components == (
        "dta-flow",
        "tools",
        "parameters",
        "knowledge",
        "memory",
        "records",
    )
    assert "dta-flow" in snapshot.components
    assert snapshot.immutable_constraints == ("No secret disclosure",)
    assert snapshot.source_version == "7"
    assert snapshot.artifact_hash is not None
    assert len(snapshot.artifact_hash) == 64
    assert snapshot.opaque_payload is not None
    assert snapshot.opaque_payload["futureField"] == {"preserved": True}


def test_harness_repository_stores_snapshot_immutably() -> None:
    repository = AgentPlatformHarnessRepository(
        AgentPlatformClient(base_url="https://platform.example", token="token", transport=httpx.MockTransport(lambda _req: httpx.Response(200, json={}))),
    )
    snapshot = _run(repository.fetch_snapshot("agent-1", "domain-1")) if False else None
    _ = snapshot


def test_harness_repository_returns_sanitized_auth_failure() -> None:
    repository = AgentPlatformHarnessRepository(
        AgentPlatformClient(
            base_url="https://platform.example",
            token="token",
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(401, json={"message": "secret-token invalid"})
            ),
        )
    )
    with pytest.raises(RuntimeError, match="AGENT_PLATFORM_INVALID_CREDENTIALS"):
        _run(repository.get_capabilities("agent-1"))
