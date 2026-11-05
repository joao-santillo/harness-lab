from __future__ import annotations

import asyncio
import base64

import httpx
import pytest

from harness_lab.adapters.langfuse.client import LangfuseClient


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def test_langfuse_client_builds_basic_auth_and_accept_header() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization", "")
        captured["accept"] = request.headers.get("accept", "")
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    client = LangfuseClient(
        base_url="https://langfuse.example",
        public_key="pk",
        secret_key="sk-secret",
        transport=transport,
    )

    response = _run(client.get("/api/public/v2/observations?limit=1"))
    assert response.status_code == 200
    expected = base64.b64encode("pk:sk-secret".encode("utf-8")).decode("ascii")
    assert captured["authorization"] == f"Basic {expected}"
    assert captured["accept"] == "application/json"


def test_langfuse_client_rejects_non_http_scheme() -> None:
    with pytest.raises(ValueError, match="LANGFUSE_URL_INVALID"):
        LangfuseClient(base_url="file:///tmp/x", public_key="pk", secret_key="sk")
