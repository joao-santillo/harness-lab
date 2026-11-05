from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx


class AgentPlatformClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        timeout_ms: int = 10_000,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("AGENT_PLATFORM_URL_INVALID")

        self._base_url = base_url
        self._token = token
        self._timeout = timeout_ms / 1_000
        self._transport = transport

    async def request(self, path: str, **kwargs: Any) -> httpx.Response:
        headers = {"accept": "application/json", "authorization": f"Bearer {self._token}"}
        incoming = kwargs.pop("headers", None)
        if isinstance(incoming, dict):
            headers.update(incoming)

        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
            ) as client:
                return await client.request(kwargs.pop("method", "GET"), path, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise RuntimeError("AGENT_PLATFORM_REQUEST_FAILED") from error
