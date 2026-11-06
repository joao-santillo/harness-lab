from __future__ import annotations

import csv
import io
from datetime import UTC, datetime

from fastapi import APIRouter, FastAPI, HTTPException, Query, status
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from harness_lab.adapters.langfuse import langfuse_case_id
from harness_lab.domain.models.case import CaseRecord

from ..services import ApiServices


class CaseImportItem(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=120)
    session_id: str = Field(min_length=1, max_length=200, validation_alias="sessionId", serialization_alias="sessionId")
    similarity_group: str = Field(min_length=1, max_length=200, validation_alias="similarityGroup", serialization_alias="similarityGroup")
    content: str = Field(min_length=1, max_length=20_000)
    source: str = "manual"
    source_reference: str | None = Field(default=None, validation_alias="sourceReference", serialization_alias="sourceReference")
    synthetic_label: str | None = Field(default=None, validation_alias="syntheticLabel", serialization_alias="syntheticLabel")
    created_at: str = Field(validation_alias="createdAt", serialization_alias="createdAt")


class CaseImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    agent_id: str = Field(min_length=1, validation_alias="agentId", serialization_alias="agentId")
    domain_id: str = Field(min_length=1, validation_alias="domainId", serialization_alias="domainId")
    source: str
    cases: tuple[CaseImportItem, ...] = Field(min_length=1, max_length=40)


class CsvImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    agent_id: str = Field(min_length=1, validation_alias=AliasChoices("agentId", "agent_id"))
    domain_id: str = Field(min_length=1, validation_alias=AliasChoices("domainId", "domain_id"))
    csv_content: str = Field(min_length=1, max_length=250_000, validation_alias=AliasChoices("csv", "csv_content"))


class LangfuseImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    agent_id: str = Field(min_length=1, validation_alias=AliasChoices("agentId", "agent_id"))
    domain_id: str = Field(min_length=1, validation_alias=AliasChoices("domainId", "domain_id"))
    connection_id: str = Field(min_length=3, validation_alias=AliasChoices("connectionId", "connection_id"))
    from_start_time: str = Field(validation_alias=AliasChoices("fromStartTime", "from_start_time"))
    to_start_time: str = Field(validation_alias=AliasChoices("toStartTime", "to_start_time"))
    limit: int = Field(ge=1, le=40)


class PreviewConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    preview_id: str = Field(min_length=1, validation_alias=AliasChoices("previewId", "preview_id"))
    trace_ids: tuple[str, ...] = Field(min_length=1, max_length=40, validation_alias=AliasChoices("traceIds", "trace_ids"))


def _to_case(item: CaseImportItem, payload: CaseImportRequest) -> CaseRecord:
    return CaseRecord.model_validate(
        {
            **item.model_dump(by_alias=True),
            "agentId": payload.agent_id,
            "domainId": payload.domain_id,
            "source": payload.source,
        }
    )


def register_case_routes(app: FastAPI, services: ApiServices) -> None:
    router = APIRouter(prefix="/api/v1/cases", tags=["cases"])

    @router.get("")
    async def list_cases(
        agent_id: str = Query(min_length=1, alias="agentId"),
        domain_id: str = Query(min_length=1, alias="domainId"),
    ) -> dict[str, tuple[CaseRecord, ...]]:
        return {"items": await services.cases.list_by_scope(agent_id, domain_id)}

    @router.post("/import", status_code=status.HTTP_201_CREATED)
    async def import_cases(payload: CaseImportRequest) -> dict[str, int]:
        try:
            imported = await services.cases.save_many(tuple(_to_case(item, payload) for item in payload.cases))
        except ValueError as error:
            code = str(error)
            status_code = 409 if code == "CASE_ALREADY_EXISTS" else 422 if code == "CASE_SCOPE_INVALID" else 400
            raise HTTPException(status_code=status_code, detail={"code": code}) from error
        return {"imported": imported}

    @router.post("/import-csv", status_code=status.HTTP_201_CREATED)
    async def import_csv(payload: CsvImportRequest) -> dict[str, int]:
        try:
            reader = csv.DictReader(io.StringIO(payload.csv_content, newline=""), strict=True)
            expected = ["id", "sessionId", "similarityGroup", "content"]
            if reader.fieldnames != expected:
                raise ValueError("CASE_CSV_INVALID")
            now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            records = tuple(
                CaseRecord.model_validate(
                    {
                        "id": row["id"],
                        "agentId": payload.agent_id,
                        "domainId": payload.domain_id,
                        "sessionId": row["sessionId"],
                        "similarityGroup": row["similarityGroup"],
                        "content": row["content"],
                        "source": "csv",
                        "createdAt": now,
                    }
                )
                for row in reader
            )
            imported = await services.cases.save_many(records)
        except (csv.Error, KeyError, TypeError, ValueError) as error:
            code = str(error)
            if code in {"CASE_ALREADY_EXISTS", "CASE_SCOPE_INVALID", "CASE_ID_DUPLICATE"}:
                status_code = 409 if code == "CASE_ALREADY_EXISTS" else 422 if code == "CASE_SCOPE_INVALID" else 400
                raise HTTPException(status_code=status_code, detail={"code": code}) from error
            raise HTTPException(status_code=400, detail={"code": "CASE_CSV_INVALID"}) from error
        return {"imported": imported}

    @router.post("/import-langfuse/preview")
    async def preview_langfuse(payload: LangfuseImportRequest) -> dict[str, object]:
        if services.recover_langfuse_cases is None or services.langfuse_previews is None:
            raise HTTPException(status_code=503, detail={"code": "CONNECTION_UNAVAILABLE"})
        result = await services.recover_langfuse_cases(payload.model_dump(by_alias=True))
        ready = [item.candidate for item in result.items if item.status == "ready" and item.candidate is not None]
        available = []
        items = []
        existing = 0
        for item in result.items:
            if item.status == "ready" and item.candidate is not None:
                candidate = item.candidate
                exists = services.database.prepare("SELECT id FROM cases WHERE id = ?").get(
                    langfuse_case_id(payload.connection_id, candidate.trace_id)
                ) is not None
                existing += int(exists)
                if not exists:
                    available.append(
                        {
                            "trace_id": candidate.trace_id,
                            "session_id": candidate.session_id,
                            "similarity_group": candidate.similarity_group,
                            "content": candidate.content,
                            "start_time": candidate.start_time,
                        }
                    )
                items.append({"status": "ready", "traceId": candidate.trace_id, "startTime": candidate.start_time, "existing": exists})
            else:
                items.append({"status": "discarded", "traceId": item.trace_id, "startTime": item.start_time, "reason": item.reason})
        preview = services.langfuse_previews.create(
            agent_id=payload.agent_id,
            domain_id=payload.domain_id,
            connection_id=payload.connection_id,
            ready=available,
        )
        return {
            "previewId": preview["preview_id"],
            "expiresAt": preview["expires_at"],
            "summary": {"total": len(result.items), "ready": len(ready) - existing, "existing": existing, "discarded": len(result.items) - len(ready)},
            "items": items,
            "limitations": list(result.limitations),
        }

    @router.post("/import-langfuse/confirm", status_code=status.HTTP_201_CREATED)
    async def confirm_langfuse(payload: PreviewConfirmRequest) -> dict[str, int]:
        if services.langfuse_previews is None:
            raise HTTPException(status_code=410, detail={"code": "PREVIEW_EXPIRED"})
        try:
            preview = services.langfuse_previews.consume(payload.preview_id, payload.trace_ids)
        except RuntimeError as error:
            code = str(error)
            raise HTTPException(status_code=400 if code == "PREVIEW_SELECTION_INVALID" else 410, detail={"code": code}) from error
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        records = tuple(
            CaseRecord.model_validate(
                {
                    "id": langfuse_case_id(preview["connection_id"], candidate["trace_id"]),
                    "agentId": preview["agent_id"],
                    "domainId": preview["domain_id"],
                    "sessionId": candidate["session_id"],
                    "similarityGroup": candidate["similarity_group"],
                    "content": candidate["content"],
                    "source": "historical",
                    "sourceReference": f"langfuse:{preview['connection_id']}:{candidate['trace_id']}",
                    "createdAt": now,
                }
            )
            for candidate in preview["candidates"]
        )
        imported = await services.cases.save_many_ignoring_existing(records)
        return {"imported": imported, "skipped": len(records) - imported}

    app.include_router(router)