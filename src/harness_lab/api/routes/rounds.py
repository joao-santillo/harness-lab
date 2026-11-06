from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, FastAPI, HTTPException, status

from harness_lab.domain.models.round import AgentId, DomainId, Round, RoundId

from ..schemas import CancelResponse, RoundInput
from ..services import ApiServices


def register_round_routes(app: FastAPI, services: ApiServices) -> None:
    router = APIRouter(prefix="/api/v1/rounds", tags=["rounds"])

    @router.get("")
    async def list_rounds() -> dict[str, tuple[Round, ...]]:
        return {"items": await services.repository.list_rounds()}

    @router.post("", status_code=status.HTTP_201_CREATED)
    async def create_round(payload: RoundInput) -> Round:
        agent = services.database.prepare(
            "SELECT id FROM agents WHERE id = ? AND domain_id = ?"
        ).get(payload.agent_id, payload.domain_id)
        if agent is None:
            raise HTTPException(status_code=422, detail={"code": "ROUND_SCOPE_INVALID"})
        case_count = services.database.prepare(
            "SELECT COUNT(*) AS count FROM cases WHERE agent_id = ? AND domain_id = ?"
        ).get(payload.agent_id, payload.domain_id)
        if int(case_count[0] if case_count is not None else 0) < 2:
            raise HTTPException(status_code=422, detail={"code": "ROUND_CASES_INSUFFICIENT"})
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        round_obj = Round(
            id=RoundId(payload.id),
            agent_id=AgentId(payload.agent_id),
            domain_id=DomainId(payload.domain_id),
            state="setup",
            objective=payload.objective,
            created_at=now,
            updated_at=now,
        )
        try:
            await services.repository.create_round_with_job(round_obj, now)
        except Exception as error:
            if str(error) == "ROUND_ALREADY_EXISTS" or "UNIQUE constraint failed" in str(error):
                raise HTTPException(status_code=409, detail={"code": "ROUND_ALREADY_EXISTS"}) from error
            raise
        return round_obj

    @router.get("/{round_id}")
    async def get_round(round_id: str) -> Round:
        round_obj = await services.repository.get_round(round_id)
        if round_obj is None:
            raise HTTPException(status_code=404, detail={"code": "ROUND_NOT_FOUND"})
        return round_obj

    @router.get("/{round_id}/results")
    async def get_results(round_id: str) -> dict[str, object]:
        if await services.repository.get_round(round_id) is None:
            raise HTTPException(status_code=404, detail={"code": "ROUND_NOT_FOUND"})
        session = await services.artifacts.get(round_id)
        if session is None or session.get("evaluation") is None:
            raise HTTPException(status_code=409, detail={"code": "ROUND_RESULT_NOT_READY"})
        evaluation = session["evaluation"]
        if not isinstance(evaluation, dict):
            raise HTTPException(status_code=409, detail={"code": "ROUND_RESULT_NOT_READY"})
        return {
            "roundId": round_id,
            "decision": evaluation.get("decision"),
            "sampleSize": evaluation.get("sampleSize"),
            "confidence": evaluation.get("confidence"),
            "aggregateScoreChange": evaluation.get("aggregateScoreChange"),
            "costChange": evaluation.get("costChange"),
            "latencyChange": evaluation.get("latencyChange"),
            "cases": evaluation.get("cases", []),
            "limitations": evaluation.get("limitations", []),
            "rationale": evaluation.get("rationale"),
        }

    @router.post("/{round_id}/cancel", response_model=CancelResponse, status_code=status.HTTP_202_ACCEPTED)
    async def cancel_round(round_id: str) -> CancelResponse:
        if await services.repository.get_round(round_id) is None:
            raise HTTPException(status_code=404, detail={"code": "ROUND_NOT_FOUND"})
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        if not services.jobs.request_cancellation(round_id, now):
            raise HTTPException(status_code=409, detail={"code": "ROUND_NOT_ACTIVE"})
        return CancelResponse(id=round_id, cancellation_requested=True)

    app.include_router(router)