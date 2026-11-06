from __future__ import annotations

from fastapi import APIRouter, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from ..services import ApiServices


class ConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=3, max_length=100, pattern=r"^[a-z0-9][a-z0-9-]*$")
    kind: str = Field(pattern=r"^(langfuse|agent-platform)$")
    name: str = Field(min_length=1, max_length=120)
    credentials: dict[str, str] = Field(min_length=1)


def register_connection_routes(app: FastAPI, services: ApiServices) -> None:
    router = APIRouter(prefix="/api/v1/connections", tags=["connections"])

    @router.get("")
    async def list_connections() -> dict[str, list[dict[str, object]]]:
        rows = services.database.prepare(
            "SELECT id, kind, name FROM connection_registrations ORDER BY name COLLATE NOCASE, id"
        ).all()
        return {
            "items": [
                {"id": str(row[0]), "kind": str(row[1]), "name": str(row[2]), "configured": True}
                for row in rows
            ]
        }

    @router.get("/{connection_id}")
    async def get_connection(connection_id: str) -> dict[str, object]:
        row = services.database.prepare(
            "SELECT id, kind, name FROM connection_registrations WHERE id = ?"
        ).get(connection_id)
        if row is None:
            raise HTTPException(status_code=404, detail={"code": "CONNECTION_NOT_FOUND"})
        return {"id": str(row[0]), "kind": str(row[1]), "name": str(row[2]), "configured": True}

    @router.get("/{connection_id}/credentials")
    async def credentials_status(connection_id: str) -> dict[str, object]:
        row = services.database.prepare(
            "SELECT 1 FROM encrypted_secrets WHERE id = ?"
        ).get(connection_id)
        registration = services.database.prepare(
            "SELECT 1 FROM connection_registrations WHERE id = ?"
        ).get(connection_id)
        if registration is None:
            raise HTTPException(status_code=404, detail={"code": "CONNECTION_NOT_FOUND"})
        return {"connectionId": connection_id, "configured": row is not None}

    @router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_connection(connection_id: str) -> None:
        def operation() -> None:
            existing = services.database.prepare(
                "SELECT 1 FROM connection_registrations WHERE id = ?"
            ).get(connection_id)
            if existing is None:
                raise HTTPException(status_code=404, detail={"code": "CONNECTION_NOT_FOUND"})
            services.database.prepare("DELETE FROM connection_registrations WHERE id = ?").run(connection_id)
            services.database.prepare("DELETE FROM encrypted_secrets WHERE id = ?").run(connection_id)

        services.database.transaction(operation)()

    @router.post("", status_code=status.HTTP_201_CREATED)
    async def create_connection(
        payload: ConnectionInput,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> dict[str, object]:
        if services.register_connection is None:
            raise HTTPException(status_code=503, detail={"code": "CONNECTION_UNAVAILABLE"})
        try:
            result = await services.register_connection.execute(
                {**payload.model_dump(), "idempotency_key": idempotency_key}
            )
        except Exception as error:
            code = getattr(error, "code", str(error))
            if code == "IDEMPOTENCY_CONFLICT":
                raise HTTPException(status_code=409, detail={"code": code}) from error
            if code == "CONNECTION_AUTH_FAILED":
                raise HTTPException(status_code=422, detail={"code": code}) from error
            if code == "CONNECTION_UNAVAILABLE":
                raise HTTPException(status_code=503, detail={"code": code}) from error
            raise
        return result.connection.model_dump(by_alias=True)

    app.include_router(router)