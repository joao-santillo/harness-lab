from __future__ import annotations

import asyncio

import httpx
import pytest

from harness_lab.adapters.agent_platform.client import AgentPlatformClient


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def test_agent_platform_client_uses_bearer_auth() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization", "")
        captured["accept"] = request.headers.get("accept", "")
        return httpx.Response(200, json={"ok": True})

    client = AgentPlatformClient(
        base_url="https://platform.example",
        token="platform-token",
        transport=httpx.MockTransport(handler),
    )
    response = _run(client.request("/api/agents/agent-1/capabilities"))
    assert response.status_code == 200
    assert captured["authorization"] == "Bearer platform-token"
    assert captured["accept"] == "application/json"


def test_agent_platform_client_rejects_non_http_scheme() -> None:
    with pytest.raises(ValueError, match="AGENT_PLATFORM_URL_INVALID"):
        AgentPlatformClient(base_url="file:///tmp/x", token="token")
