from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, FastAPI, HTTPException, status

from ..schemas import AgentInput
from ..services import ApiServices


def register_agent_routes(app: FastAPI, services: ApiServices) -> None:
    router = APIRouter(prefix="/api/v1/agents", tags=["agents"])

    @router.get("")
    async def list_agents() -> dict[str, list[dict[str, str]]]:
        rows = services.database.prepare(
            "SELECT id, domain_id AS domainId, name, created_at AS createdAt "
            "FROM agents ORDER BY created_at, id"
        ).all()
        return {"items": [dict(row) for row in rows]}

    @router.post("", status_code=status.HTTP_201_CREATED)
    async def create_agent(payload: AgentInput) -> dict[str, str]:
        created_at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        try:
            services.database.prepare(
                "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
            ).run(payload.id, payload.domain_id, payload.name, created_at)
            await services.database.flush()
        except Exception as error:
            if "UNIQUE constraint failed" in str(error):
                raise HTTPException(status_code=409, detail={"code": "AGENT_ALREADY_EXISTS"}) from error
            raise
        return {**payload.model_dump(by_alias=True), "createdAt": created_at}

    app.include_router(router)