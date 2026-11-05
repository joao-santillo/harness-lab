from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable

import httpx

from harness_lab.domain.models.evidence import EvidenceTrace
from harness_lab.domain.ports import TracePage, TraceQuery, TraceRepository

from .client import LangfuseClient
from .normalize import normalize_observations


class LangfuseTraceRepository(TraceRepository):
    def __init__(
        self,
        *,
        client: LangfuseClient,
        project_id: str,
        observations_api: str,
        delay: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        self._client = client
        self._project_id = project_id
        self._observations_api = observations_api
        self._delay = delay or (lambda _milliseconds: asyncio.sleep(0))

    async def _get_with_retry(self, path: str) -> httpx.Response:
        response = await self._client.get(path)
        if response.status_code == 429:
            try:
                seconds = float(response.headers.get("retry-after", "1"))
            except ValueError:
                seconds = 1.0
            await self._delay(int(min(max(seconds, 0), 30) * 1000))
            response = await self._client.get(path)

        if not response.is_success:
            if response.status_code == 429:
                raise RuntimeError("LANGFUSE_RATE_LIMITED")
            raise RuntimeError("LANGFUSE_TRACE_COLLECTION_FAILED")
        return response

    async def collect(self, query: TraceQuery) -> TracePage:
        first_page = int(query.cursor or "1")
        evidence: list[EvidenceTrace] = []
        current_page = first_page
        total_pages = first_page

        while current_page <= total_pages and len(evidence) < query.limit:
            page_limit = min(query.limit, 100)
            if self._observations_api == "v2":
                parameters = httpx.QueryParams(
                    {
                        "page": str(current_page),
                        "limit": str(page_limit),
                        "fromStartTime": query.from_,
                        "toStartTime": query.to,
                    }
                )
                response = await self._get_with_retry(f"/api/public/v2/observations?{parameters}")
                body = response.json()
                data = body.get("data")
                meta = body.get("meta")
                if not isinstance(data, list) or not isinstance(meta, dict):
                    raise RuntimeError("LANGFUSE_TRACE_COLLECTION_FAILED")
                total_pages = int(meta.get("totalPages", current_page))
                normalized = normalize_observations(self._project_id, data)
                evidence.extend(
                    EvidenceTrace(
                        kind="trace",
                        id=f"{self._project_id}:{observation.id}",
                        round_id=query.round_id,
                        case_id=observation.trace_id,
                        trace_id=observation.trace_id,
                        observation_id=observation.id,
                        excerpt=json.dumps(
                            {"input": observation.input, "output": observation.output},
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )[:1000],
                        source_url=None,
                    )
                    for observation in normalized.observations
                )
            else:
                parameters = httpx.QueryParams(
                    {
                        "page": str(current_page),
                        "limit": str(page_limit),
                        "fromTimestamp": query.from_,
                        "toTimestamp": query.to,
                    }
                )
                response = await self._get_with_retry(f"/api/public/traces?{parameters}")
                body = response.json()
                data = body.get("data")
                meta = body.get("meta")
                if not isinstance(data, list) or not isinstance(meta, dict):
                    raise RuntimeError("LANGFUSE_TRACE_COLLECTION_FAILED")
                total_pages = int(meta.get("totalPages", current_page))

                for item in data:
                    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                        raise RuntimeError("LANGFUSE_TRACE_COLLECTION_FAILED")
                    trace_id = item["id"]
                    evidence.append(
                        EvidenceTrace(
                            kind="trace",
                            id=f"{self._project_id}:{trace_id}",
                            round_id=query.round_id,
                            case_id=trace_id,
                            trace_id=trace_id,
                            observation_id=None,
                            excerpt=json.dumps(
                                {
                                    "input": item.get("input"),
                                    "output": item.get("output"),
                                },
                                ensure_ascii=False,
                                separators=(",", ":"),
                            )[:1000],
                            source_url=None,
                        )
                    )

            current_page += 1

        deduplicated = list({item.id: item for item in evidence}.values())[: query.limit]
        next_cursor = str(current_page) if current_page <= total_pages else None
        return TracePage(evidence=tuple(deduplicated), next_cursor=next_cursor)
