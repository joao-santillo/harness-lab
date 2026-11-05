from __future__ import annotations

import base64
from urllib.parse import urlparse

import httpx


class LangfuseClient:
    def __init__(
        self,
        *,
        base_url: str,
        public_key: str,
        secret_key: str,
        timeout_ms: int = 5_000,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("LANGFUSE_URL_INVALID")

        token = base64.b64encode(f"{public_key}:{secret_key}".encode("utf-8")).decode("ascii")
        self._base_url = base_url
        self._authorization = f"Basic {token}"
        self._timeout = timeout_ms / 1_000
        self._transport = transport

    async def get(self, path: str) -> httpx.Response:
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                headers={
                    "accept": "application/json",
                    "authorization": self._authorization,
                },
                timeout=self._timeout,
                transport=self._transport,
            ) as client:
                return await client.get(path)
        except httpx.HTTPError as error:
            raise RuntimeError("LANGFUSE_REQUEST_FAILED") from error
