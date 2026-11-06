from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import TypeAdapter

from harness_lab.domain.models import DomainModel

from .client import LangfuseClient


class LangfuseCapabilities(DomainModel):
    observations_api: str
    scores_api: str
    supported_filters: tuple[str, ...]
    probed_at: str
    limitations: tuple[str, ...]


_legacy_probe_adapter = TypeAdapter(dict[str, object])


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


async def negotiate_langfuse_capabilities(
    client: LangfuseClient,
    now: Callable[[], str] = _now_iso,
) -> LangfuseCapabilities:
    response = await client.get("/api/public/v2/observations?limit=1")
    if response.status_code in {401, 403}:
        raise RuntimeError("LANGFUSE_INVALID_CREDENTIALS")
    if response.status_code == 429:
        raise RuntimeError("LANGFUSE_RATE_LIMITED")

    if response.is_success:
        return LangfuseCapabilities(
            observations_api="v2",
            scores_api="v3",
            supported_filters=(
                "fromStartTime",
                "toStartTime",
                "traceId",
                "type",
                "environment",
            ),
            probed_at=now(),
            limitations=(),
        )

    if response.status_code in {404, 405}:
        probed_at = now()
        try:
            to_timestamp = datetime.fromisoformat(probed_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise RuntimeError("LANGFUSE_CAPABILITY_PROBE_FAILED") from error
        from_timestamp = (to_timestamp - timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
        params = httpx.QueryParams(
            {
                "page": "1",
                "limit": "1",
                "fromTimestamp": from_timestamp,
                "toTimestamp": to_timestamp.isoformat().replace("+00:00", "Z"),
            }
        )
        legacy = await client.get(f"/api/public/traces?{params}")
        if legacy.status_code in {401, 403}:
            raise RuntimeError("LANGFUSE_INVALID_CREDENTIALS")
        if legacy.status_code == 429:
            raise RuntimeError("LANGFUSE_RATE_LIMITED")
        if not legacy.is_success:
            raise RuntimeError("LANGFUSE_CAPABILITY_PROBE_FAILED")

        body = legacy.json()
        parsed = _legacy_probe_adapter.validate_python(body)
        if not isinstance(parsed.get("data"), list):
            raise RuntimeError("LANGFUSE_CAPABILITY_PROBE_FAILED")
        meta = parsed.get("meta")
        if not isinstance(meta, dict) or not isinstance(meta.get("page"), int) or not isinstance(meta.get("totalPages"), int):
            raise RuntimeError("LANGFUSE_CAPABILITY_PROBE_FAILED")

        limitation = (
            "Observations v2 probe returned 404; using deprecated legacy trace reads."
            if response.status_code == 404
            else "Observations v2 is unavailable; using deprecated legacy trace reads."
        )
        return LangfuseCapabilities(
            observations_api="legacy",
            scores_api="v3",
            supported_filters=("fromTimestamp", "toTimestamp"),
            probed_at=probed_at,
            limitations=(limitation,),
        )

    raise RuntimeError("LANGFUSE_CAPABILITY_PROBE_FAILED")

