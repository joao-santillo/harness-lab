from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import httpx

MAX_IMPORT_LIMIT = 40
MAX_IMPORT_PAGES = 100
MAX_IMPORT_OBSERVATIONS = 1_000
MAX_IMPORT_RESPONSE_BYTES = 5 * 1024 * 1024
MAX_SESSION_ID_LENGTH = 200
MAX_SIMILARITY_GROUP_LENGTH = 200
MAX_CONTENT_LENGTH = 20_000
MAX_SOURCE_REFERENCE_LENGTH = 500
MAX_RETRY_AFTER_MS = 30_000

DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1_000
DEFAULT_PREVIEW_CAPACITY = 100
MAX_ID_ATTEMPTS = 10

LangfuseTraceDiscardReason = Literal[
    "MISSING_ROOT",
    "MISSING_USABLE_INPUT",
    "INVALID_START_TIME",
    "CONTENT_TOO_LARGE",
    "INVALID_SESSION_ID",
    "SOURCE_REFERENCE_TOO_LARGE",
    "INVALID_CONTENT",
]


@dataclass(frozen=True)
class LangfuseCaseImportCandidate:
    trace_id: str
    session_id: str
    similarity_group: str
    content: str
    start_time: str


@dataclass(frozen=True)
class LangfuseTraceRecoveryItem:
    status: Literal["ready", "discarded"]
    trace_id: str
    candidate: LangfuseCaseImportCandidate | None = None
    start_time: str | None = None
    reason: LangfuseTraceDiscardReason | None = None


@dataclass(frozen=True)
class LangfuseCaseImportResult:
    items: tuple[LangfuseTraceRecoveryItem, ...]
    limitations: tuple[str, ...]


@dataclass(frozen=True)
class _TraceObservation:
    trace_id: str
    start_time: str
    id: str | None = None
    parent_observation_id: str | None = None
    is_root_observation: bool | None = None
    session_id: str | None = None
    trace_name: str | None = None
    name: str | None = None
    input: Any = None


def is_valid_date(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _serialize_input(value: Any) -> tuple[bool, str | None, LangfuseTraceDiscardReason | None]:
    if isinstance(value, str):
        if value.strip() == "":
            return False, None, "MISSING_USABLE_INPUT"
        return True, value, None
    if value is None:
        return False, None, "MISSING_USABLE_INPUT"
    if isinstance(value, (int, float, bool)):
        return False, None, "INVALID_CONTENT"
    if not isinstance(value, (dict, list)):
        return False, None, "INVALID_CONTENT"
    try:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return False, None, "INVALID_CONTENT"
    if serialized.strip() == "":
        return False, None, "INVALID_CONTENT"
    return True, serialized, None


def _non_empty(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped != "" else None


def _retry_after_milliseconds(value: str | None) -> int:
    if value is None:
        return 1_000
    requested_ms: float
    try:
        requested_ms = float(value) * 1_000
    except ValueError:
        try:
            requested_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
            requested_ms = (requested_at - datetime.now(UTC)).total_seconds() * 1_000
        except ValueError:
            return 1_000
    if requested_ms != requested_ms:
        return 1_000
    return int(min(max(requested_ms, 0), MAX_RETRY_AFTER_MS))


def _sanitized_error(
    code: Literal[
        "LANGFUSE_INVALID_CREDENTIALS",
        "LANGFUSE_RATE_LIMITED",
        "LANGFUSE_CASE_IMPORT_FAILED",
    ],
) -> RuntimeError:
    return RuntimeError(code)


def _sanitized_limit_error() -> RuntimeError:
    return RuntimeError("LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED")


def _sanitized_response_too_large_error() -> RuntimeError:
    return RuntimeError("LANGFUSE_CASE_IMPORT_RESPONSE_TOO_LARGE")


class LangfuseCaseImportRepository:
    def __init__(
        self,
        *,
        client: Any,
        observations_api: Literal["v2", "legacy"],
        source_reference_prefix: str,
        delay: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        self._client = client
        self._observations_api = observations_api
        self._source_reference_prefix = source_reference_prefix
        self._delay = delay or (lambda milliseconds: asyncio.sleep(milliseconds / 1_000))

    async def _get(self, path: str) -> httpx.Response:
        try:
            response = await self._client.get(path)
            if response.status_code == 429:
                await self._delay(_retry_after_milliseconds(response.headers.get("retry-after")))
                response = await self._client.get(path)
        except Exception as error:
            raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED") from error

        if response.status_code in {401, 403}:
            raise _sanitized_error("LANGFUSE_INVALID_CREDENTIALS")
        if response.status_code == 429:
            raise _sanitized_error("LANGFUSE_RATE_LIMITED")
        if not response.is_success:
            raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
        return response

    async def _read_json(self, response: httpx.Response) -> Any:
        content_length = response.headers.get("content-length")
        if content_length is not None and content_length.strip().isdigit():
            if int(content_length.strip()) > MAX_IMPORT_RESPONSE_BYTES:
                await response.aclose()
                raise _sanitized_response_too_large_error()

        try:
            payload = await response.aread()
            if len(payload) > MAX_IMPORT_RESPONSE_BYTES:
                await response.aclose()
                raise _sanitized_response_too_large_error()
            return json.loads(payload.decode("utf-8"))
        except RuntimeError as error:
            if str(error) == "LANGFUSE_CASE_IMPORT_RESPONSE_TOO_LARGE":
                raise
            raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED") from error
        except Exception as error:
            raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED") from error

    def _is_root_observation(self, observation: _TraceObservation) -> bool:
        return observation.is_root_observation is True or (
            observation.is_root_observation is None
            and observation.parent_observation_id is None
        )

    def _observations(self, data: list[Any]) -> list[_TraceObservation]:
        parsed: list[_TraceObservation] = []
        for item in data:
            if not isinstance(item, dict):
                raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
            trace_id = item.get("traceId")
            start_time = item.get("startTime")
            if not isinstance(trace_id, str) or trace_id.strip() == "" or not isinstance(start_time, str):
                raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")

            id_value: str | None = None
            if "id" in item:
                requested_id = item["id"]
                if not isinstance(requested_id, str):
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                id_value = requested_id

            parent_observation_id: str | None = None
            if "parentObservationId" in item:
                requested_parent_observation_id = item["parentObservationId"]
                if not isinstance(requested_parent_observation_id, str) and requested_parent_observation_id is not None:
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                parent_observation_id = requested_parent_observation_id

            is_root_observation: bool | None = None
            if "isRootObservation" in item:
                requested_is_root_observation = item["isRootObservation"]
                if not isinstance(requested_is_root_observation, bool):
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                is_root_observation = requested_is_root_observation

            session_id: str | None = None
            if "sessionId" in item:
                requested_session_id = item["sessionId"]
                if not isinstance(requested_session_id, str) and requested_session_id is not None:
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                session_id = requested_session_id

            trace_name: str | None = None
            if "traceName" in item:
                requested_trace_name = item["traceName"]
                if not isinstance(requested_trace_name, str) and requested_trace_name is not None:
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                trace_name = requested_trace_name

            name: str | None = None
            if "name" in item:
                requested_name = item["name"]
                if not isinstance(requested_name, str) and requested_name is not None:
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                name = requested_name

            parsed.append(
                _TraceObservation(
                    id=id_value,
                    trace_id=trace_id,
                    start_time=start_time,
                    parent_observation_id=parent_observation_id,
                    is_root_observation=is_root_observation,
                    session_id=session_id,
                    trace_name=trace_name,
                    name=name,
                    input=item.get("input"),
                )
            )
        return parsed

    def _to_recovery_item(self, observations: list[_TraceObservation]) -> LangfuseTraceRecoveryItem:
        trace_id = observations[0].trace_id if observations else ""
        valid_start_times = sorted(
            [item.start_time for item in observations if is_valid_date(item.start_time)],
            key=lambda value: datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp(),
        )
        earliest_start_time = valid_start_times[0] if valid_start_times else None
        roots = [item for item in observations if self._is_root_observation(item)]
        if len(roots) == 0:
            return LangfuseTraceRecoveryItem(
                status="discarded",
                trace_id=trace_id,
                start_time=earliest_start_time,
                reason="MISSING_ROOT",
            )

        ordered = sorted(
            observations,
            key=lambda item: (
                0 if self._is_root_observation(item) else 1,
                datetime.fromisoformat(item.start_time.replace("Z", "+00:00")).timestamp()
                if is_valid_date(item.start_time)
                else float("inf"),
                item.id or "",
            ),
        )

        failures: dict[LangfuseTraceDiscardReason, str | None] = {}
        for observation in ordered:
            serialized_ok, serialized_value, reason = _serialize_input(observation.input)
            if not serialized_ok:
                assert reason is not None
                failures.setdefault(reason, observation.start_time)
                continue
            if serialized_value is None:
                failures.setdefault("INVALID_CONTENT", observation.start_time)
                continue
            if not is_valid_date(observation.start_time):
                failures.setdefault("INVALID_START_TIME", observation.start_time)
                continue
            if len(serialized_value) > MAX_CONTENT_LENGTH:
                failures.setdefault("CONTENT_TOO_LARGE", observation.start_time)
                continue
            if len(self._source_reference_prefix) + len(observation.trace_id) > MAX_SOURCE_REFERENCE_LENGTH:
                failures.setdefault("SOURCE_REFERENCE_TOO_LARGE", observation.start_time)
                continue

            requested_session_id = _non_empty(observation.session_id)
            session_id = requested_session_id or trace_id
            if session_id == "" or len(session_id) > MAX_SESSION_ID_LENGTH:
                failures.setdefault("INVALID_SESSION_ID", observation.start_time)
                continue

            similarity_group = "langfuse"
            for candidate in (_non_empty(observation.trace_name), _non_empty(observation.name)):
                if candidate is not None and len(candidate) <= MAX_SIMILARITY_GROUP_LENGTH:
                    similarity_group = candidate
                    break

            return LangfuseTraceRecoveryItem(
                status="ready",
                trace_id=trace_id,
                candidate=LangfuseCaseImportCandidate(
                    trace_id=trace_id,
                    session_id=session_id,
                    similarity_group=similarity_group,
                    content=serialized_value,
                    start_time=observation.start_time,
                ),
            )

        priority: tuple[LangfuseTraceDiscardReason, ...] = (
            "MISSING_USABLE_INPUT",
            "INVALID_CONTENT",
            "INVALID_START_TIME",
            "CONTENT_TOO_LARGE",
            "SOURCE_REFERENCE_TOO_LARGE",
            "INVALID_SESSION_ID",
        )
        reason = next((candidate for candidate in priority if candidate in failures), "MISSING_USABLE_INPUT")
        return LangfuseTraceRecoveryItem(
            status="discarded",
            trace_id=trace_id,
            start_time=failures.get(reason),
            reason=reason,
        )

    async def import_cases(
        self,
        *,
        from_start_time: str,
        to_start_time: str,
        limit: int,
        filter: dict[str, str] | None = None,
    ) -> LangfuseCaseImportResult:
        from_value = datetime.fromisoformat(from_start_time.replace("Z", "+00:00"))
        to_value = datetime.fromisoformat(to_start_time.replace("Z", "+00:00"))
        if from_value >= to_value or limit < 1 or limit > MAX_IMPORT_LIMIT:
            raise ValueError("CASE_LANGFUSE_INVALID")

        observations_by_trace: dict[str, list[_TraceObservation]] = {}
        limitations: list[str] = []
        seen_cursors: set[str] = set()
        pages_read = 0
        observations_read = 0

        if self._observations_api == "legacy":
            limitations.append("Langfuse legacy trace endpoint is deprecated.")

        def take_observation_budget(data: list[Any]) -> tuple[list[Any], bool]:
            nonlocal observations_read
            remaining = MAX_IMPORT_OBSERVATIONS - observations_read
            selected = data[:remaining]
            observations_read += len(selected)
            return selected, len(selected) < len(data)

        def add_roots(items: list[_TraceObservation]) -> None:
            for observation in items:
                observations_by_trace.setdefault(observation.trace_id, []).append(observation)

        def current_items() -> list[LangfuseTraceRecoveryItem]:
            items = [self._to_recovery_item(items) for items in observations_by_trace.values()]

            def item_sort_key(item: LangfuseTraceRecoveryItem) -> tuple[float, str]:
                start_time = item.candidate.start_time if item.status == "ready" and item.candidate else item.start_time
                if start_time is not None and is_valid_date(start_time):
                    return (datetime.fromisoformat(start_time.replace("Z", "+00:00")).timestamp(), item.trace_id)
                return (float("inf"), item.trace_id)

            items.sort(key=item_sort_key)
            return items

        if self._observations_api == "v2":
            cursor: str | None = None
            while True:
                parameters: dict[str, str] = {
                    "fromStartTime": from_start_time,
                    "toStartTime": to_start_time,
                    "fields": "core,basic,io,trace_context",
                    "limit": str(limit),
                }
                if filter is not None:
                    field = filter["field"]
                    value = filter["value"]
                    if field in {"environment", "userId", "sessionId"}:
                        parameters[field] = value
                    else:
                        selected_filter = (
                            {
                                "type": "string",
                                "column": "traceName",
                                "operator": "=",
                                "value": value,
                            }
                            if field == "traceName"
                            else {
                                "type": "arrayOptions",
                                "column": "tags",
                                "operator": "any of",
                                "value": [value],
                            }
                        )
                        parameters["filter"] = json.dumps(
                            [
                                {
                                    "type": "datetime",
                                    "column": "startTime",
                                    "operator": ">=",
                                    "value": from_start_time,
                                },
                                {
                                    "type": "datetime",
                                    "column": "startTime",
                                    "operator": "<",
                                    "value": to_start_time,
                                },
                                selected_filter,
                            ],
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )
                if cursor is not None:
                    parameters["cursor"] = cursor

                response = await self._get(f"/api/public/v2/observations?{httpx.QueryParams(parameters)}")
                body = await self._read_json(response)
                if not isinstance(body, dict):
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                data = body.get("data")
                meta = body.get("meta")
                if not isinstance(data, list) or not isinstance(meta, dict):
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                pages_read += 1
                selected, truncated = take_observation_budget(data)
                if truncated:
                    raise _sanitized_limit_error()
                add_roots(self._observations(selected))

                next_cursor = meta.get("cursor")
                if not isinstance(next_cursor, str) or next_cursor == "":
                    break
                if pages_read >= MAX_IMPORT_PAGES or observations_read >= MAX_IMPORT_OBSERVATIONS:
                    raise _sanitized_limit_error()
                if next_cursor in seen_cursors:
                    limitations.append("Langfuse returned a repeated cursor; pagination stopped.")
                    break
                seen_cursors.add(next_cursor)
                cursor = next_cursor
        else:
            page = 1
            total_pages = 1
            while page <= total_pages:
                parameters: dict[str, str] = {
                    "page": str(page),
                    "limit": str(limit),
                    "fromTimestamp": from_start_time,
                    "toTimestamp": to_start_time,
                }
                if filter is not None:
                    field = filter["field"]
                    value = filter["value"]
                    parameters["name" if field == "traceName" else field] = value

                response = await self._get(f"/api/public/traces?{httpx.QueryParams(parameters)}")
                body = await self._read_json(response)
                if not isinstance(body, dict):
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                data = body.get("data")
                meta = body.get("meta")
                if not isinstance(data, list) or not isinstance(meta, dict):
                    raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                pages_read += 1
                selected, truncated = take_observation_budget(data)
                if truncated:
                    raise _sanitized_limit_error()

                traces: list[_TraceObservation] = []
                for item in selected:
                    if not isinstance(item, dict):
                        raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                    trace_id = item.get("id")
                    timestamp = item.get("timestamp")
                    if not isinstance(trace_id, str) or not isinstance(timestamp, str):
                        raise _sanitized_error("LANGFUSE_CASE_IMPORT_FAILED")
                    traces.append(
                        _TraceObservation(
                            id=trace_id,
                            trace_id=trace_id,
                            start_time=timestamp,
                            is_root_observation=True,
                            input=item.get("input"),
                            session_id=item.get("sessionId")
                            if isinstance(item.get("sessionId"), str) or item.get("sessionId") is None
                            else None,
                            trace_name=item.get("traceName")
                            if isinstance(item.get("traceName"), str) or item.get("traceName") is None
                            else None,
                            name=item.get("name") if isinstance(item.get("name"), str) or item.get("name") is None else None,
                        )
                    )
                add_roots(traces)
                total_pages = int(meta.get("totalPages", 1))
                if page >= total_pages:
                    break
                if pages_read >= MAX_IMPORT_PAGES or observations_read >= MAX_IMPORT_OBSERVATIONS:
                    raise _sanitized_limit_error()
                page += 1

        return LangfuseCaseImportResult(
            items=tuple(current_items()[:limit]),
            limitations=tuple(limitations),
        )


def langfuse_case_id(connection_id: str, trace_id: str) -> str:
    digest = hashlib.sha256(f"{connection_id}:{trace_id}".encode("utf-8")).hexdigest()[:64]
    return f"langfuse-{digest}"


class LangfuseImportPreviewStore:
    def __init__(
        self,
        *,
        now: Callable[[], int] | None = None,
        ttl_ms: int = DEFAULT_PREVIEW_TTL_MS,
        capacity: int = DEFAULT_PREVIEW_CAPACITY,
        create_id: Callable[[], str] | None = None,
    ) -> None:
        if ttl_ms <= 0 or capacity <= 0 or int(capacity) != capacity:
            raise RuntimeError("LANGFUSE_PREVIEW_STORE_INVALID_OPTIONS")
        self._now = now or (lambda: int(datetime.now(UTC).timestamp() * 1_000))
        self._ttl_ms = ttl_ms
        self._capacity = capacity
        self._create_id = create_id or (lambda: secrets.token_urlsafe(24))
        self._previews: dict[str, dict[str, Any]] = {}

    def create(
        self,
        *,
        agent_id: str,
        domain_id: str,
        connection_id: str,
        ready: tuple[dict[str, Any], ...] | list[dict[str, Any]],
    ) -> dict[str, str]:
        now = self._now()
        self._purge_expired(now)

        preview_id: str | None = None
        for _ in range(MAX_ID_ATTEMPTS):
            candidate_id = self._create_id()
            if candidate_id not in self._previews:
                preview_id = candidate_id
                break
        if preview_id is None:
            raise RuntimeError("LANGFUSE_PREVIEW_ID_UNAVAILABLE")

        while len(self._previews) >= self._capacity:
            self._evict_oldest()

        expires_at = now + self._ttl_ms
        self._previews[preview_id] = {
            "agent_id": agent_id,
            "domain_id": domain_id,
            "connection_id": connection_id,
            "ready": [copy.deepcopy(item) for item in ready],
            "expires_at": expires_at,
        }
        return {
            "preview_id": preview_id,
            "expires_at": datetime.fromtimestamp(expires_at / 1_000, tz=UTC)
            .isoformat()
            .replace("+00:00", "Z"),
        }

    def consume(self, preview_id: str, trace_ids: tuple[str, ...] | list[str]) -> dict[str, Any]:
        now = self._now()
        self._purge_expired(now)
        preview = self._previews.get(preview_id)
        if preview is None:
            raise RuntimeError("PREVIEW_EXPIRED")

        selected = set(trace_ids)
        ready_by_trace_id = {item["trace_id"]: item for item in preview["ready"]}
        if len(trace_ids) == 0 or len(selected) != len(trace_ids) or any(item not in ready_by_trace_id for item in trace_ids):
            raise RuntimeError("PREVIEW_SELECTION_INVALID")

        candidates = [copy.deepcopy(ready_by_trace_id[trace_id]) for trace_id in trace_ids]
        del self._previews[preview_id]
        return {
            "agent_id": preview["agent_id"],
            "domain_id": preview["domain_id"],
            "connection_id": preview["connection_id"],
            "candidates": candidates,
        }

    def _purge_expired(self, now: int) -> None:
        for preview_id in list(self._previews.keys()):
            if self._previews[preview_id]["expires_at"] <= now:
                del self._previews[preview_id]

    def _evict_oldest(self) -> None:
        oldest_id: str | None = None
        oldest_expiry = float("inf")
        for preview_id, preview in self._previews.items():
            if preview["expires_at"] < oldest_expiry:
                oldest_id = preview_id
                oldest_expiry = preview["expires_at"]
        if oldest_id is not None:
            del self._previews[oldest_id]
