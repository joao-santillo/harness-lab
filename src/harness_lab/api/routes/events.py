from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from harness_lab.domain.models.round import RoundProgressEvent

from ..services import ApiServices

TERMINAL_STATES = {
    "recommended", "rejected", "inconclusive", "pending_validation",
    "validation_insufficient", "stopped_by_limit", "cancelled", "integration_failed",
}
POLL_INTERVAL_SECONDS = 0.25
HEARTBEAT_INTERVAL_SECONDS = 15.0


def _last_sequence(value: str | None) -> int:
    try:
        sequence = int(value) if value is not None else -1
    except ValueError:
        return -1
    return sequence if sequence >= -1 else -1


def _format_event(event: RoundProgressEvent) -> str:
    payload = event.model_dump(by_alias=True)
    return f"id: {event.sequence}\nevent: round-progress\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def register_event_routes(app: FastAPI, services: ApiServices) -> None:
    router = APIRouter(prefix="/api/v1/rounds", tags=["events"])

    @router.get("/{round_id}/events")
    async def stream_events(round_id: str, last_event_id: str | None = Header(default=None, alias="Last-Event-ID")) -> StreamingResponse:
        if await services.repository.get_round(round_id) is None:
            raise HTTPException(status_code=404, detail={"code": "ROUND_NOT_FOUND"})

        async def generate() -> AsyncIterator[str]:
            sequence = _last_sequence(last_event_id)
            last_activity = time.monotonic()
            while True:
                events = await services.repository.list_events(round_id, sequence)
                for event in events:
                    yield _format_event(event)
                    sequence = event.sequence
                    last_activity = time.monotonic()
                current = await services.repository.get_round(round_id)
                if current is None or current.state in TERMINAL_STATES:
                    break
                now = time.monotonic()
                if now - last_activity >= HEARTBEAT_INTERVAL_SECONDS:
                    yield ": heartbeat\n\n"
                    last_activity = now
                await asyncio.sleep(POLL_INTERVAL_SECONDS)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive"},
        )

    app.include_router(router)