from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from harness_lab.adapters.security.secretbox_codec import SecretBoxCodec
from harness_lab.api.services import ApiServices

_FAILURE_TAXONOMY: tuple[tuple[str, str], ...] = (
    ("harness", "Prompt incompleto"),
    ("harness", "Ferramenta mal usada"),
    ("harness", "Contexto perdido"),
    ("harness", "Formato invalido"),
    ("harness", "Loop sem saida"),
    ("harness", "Alucinacao factual"),
    ("harness", "Politica violada"),
    ("harness", "Resposta incompleta"),
    ("infra", "Timeout de rede"),
    ("infra", "Credencial expirada"),
    ("infra", "Servico indisponivel"),
)


def register_web_routes(app: FastAPI, services: ApiServices) -> None:
    templates = Jinja2Templates(directory=Path(__file__).with_name("templates"))
    router = APIRouter(tags=["web"])

    def _utc_now() -> str:
        from datetime import UTC, datetime

        return datetime.now(UTC).isoformat().replace("+00:00", "Z")

    def _count(table: str) -> int:
        row = services.database.prepare(f"SELECT COUNT(*) FROM {table}").get()
        return int(row[0]) if row is not None else 0

    @router.get("/", response_class=HTMLResponse)
    async def home(request: Request) -> HTMLResponse:
        metrics = {
            "agents": _count("agents"),
            "cases": _count("cases"),
            "rounds": _count("rounds"),
            "connections": _count("connection_registrations"),
        }
        return templates.TemplateResponse(
            request=request,
            name="home.html",
            context={
                "metrics": metrics,
                "agents": _list_agents(),
                "recent_rounds": _recent_rounds(),
                "failure_taxonomy": _FAILURE_TAXONOMY,
            },
        )

    def _recent_rounds() -> list[dict[str, object]]:
        rows = services.database.prepare(
            "SELECT r.id, r.state, r.objective, r.created_at, a.name AS agentName, "
            "r.domain_id AS domainId FROM rounds r "
            "LEFT JOIN agents a ON a.id = r.agent_id "
            "ORDER BY r.created_at DESC LIMIT 5"
        ).all()
        return [dict(row) for row in rows]

    def _list_agents() -> list[dict[str, object]]:
        rows = services.database.prepare(
            "SELECT id, domain_id AS domainId, name FROM agents ORDER BY name COLLATE NOCASE, id"
        ).all()
        return [dict(row) for row in rows]

    @router.get("/workspace/agents", response_class=HTMLResponse)
    async def agents_page(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request=request,
            name="agents.html",
            context={"agents": _list_agents()},
        )

    @router.post("/agents")
    async def create_agent(
        agent_id: str = Form(), domain_id: str = Form(), name: str = Form()
    ) -> RedirectResponse:
        services.database.prepare(
            "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
        ).run(agent_id.strip(), domain_id.strip(), name.strip(), _utc_now())
        return RedirectResponse("/workspace/agents?created=agent", status_code=303)

    @router.post("/agents/{agent_id}/update")
    async def update_agent(
        agent_id: str, domain_id: str = Form(), name: str = Form()
    ) -> RedirectResponse:
        services.database.prepare(
            "UPDATE agents SET domain_id = ?, name = ? WHERE id = ?"
        ).run(domain_id.strip(), name.strip(), agent_id)
        return RedirectResponse("/workspace/agents?updated=agent", status_code=303)

    @router.post("/agents/{agent_id}/delete")
    async def delete_agent(agent_id: str) -> RedirectResponse:
        def operation() -> None:
            services.database.prepare("DELETE FROM cases WHERE agent_id = ?").run(agent_id)
            services.database.prepare("DELETE FROM agents WHERE id = ?").run(agent_id)

        services.database.transaction(operation)()
        return RedirectResponse("/workspace/agents?deleted=agent", status_code=303)

    @router.get("/cases", response_class=HTMLResponse)
    async def cases_page(request: Request) -> HTMLResponse:
        import json

        rows = services.database.prepare(
            "SELECT id, agent_id AS agentId, domain_id AS domainId, payload_json "
            "FROM cases ORDER BY created_at DESC, id"
        ).all()
        cases: list[dict[str, object]] = []
        for row in rows:
            record = dict(row)
            try:
                payload = json.loads(str(record.pop("payload_json", "") or "{}"))
            except ValueError:
                payload = {}
            record["content"] = payload.get("content", "")
            record["sessionId"] = payload.get("sessionId", "")
            record["similarityGroup"] = payload.get("similarityGroup", "")
            cases.append(record)
        return templates.TemplateResponse(
            request=request,
            name="cases.html",
            context={"agents": _list_agents(), "cases": cases},
        )

    @router.post("/cases/csv")
    async def import_csv_form(
        agent_id: str = Form(), domain_id: str = Form(), csv_content: str = Form()
    ) -> RedirectResponse:
        import httpx

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://harness.local") as client:
            response = await client.post(
                "/api/v1/cases/import-csv",
                json={"agentId": agent_id, "domainId": domain_id, "csv": csv_content},
            )
        target = "/cases?" + urlencode({"imported": response.json().get("imported", 0)})
        return RedirectResponse(target, status_code=303)

    def _langfuse_connections() -> list[dict[str, object]]:
        rows = services.database.prepare(
            "SELECT id, name FROM connection_registrations WHERE kind = 'langfuse' "
            "ORDER BY name COLLATE NOCASE, id"
        ).all()
        return [dict(row) for row in rows]

    @router.post("/cases/langfuse/preview", response_class=HTMLResponse)
    async def preview_langfuse_form(
        request: Request,
        agent_id: str = Form(),
        domain_id: str = Form(),
        connection_id: str = Form(),
        from_start_time: str = Form(),
        to_start_time: str = Form(),
        limit: int = Form(default=20),
    ) -> HTMLResponse:
        import httpx

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://harness.local") as client:
            response = await client.post(
                "/api/v1/cases/import-langfuse/preview",
                json={
                    "agentId": agent_id.strip(),
                    "domainId": domain_id.strip(),
                    "connectionId": connection_id.strip(),
                    "fromStartTime": from_start_time.strip(),
                    "toStartTime": to_start_time.strip(),
                    "limit": int(limit),
                },
            )
        if response.status_code != 200:
            detail = ""
            try:
                detail = str(response.json().get("detail", {}).get("code", ""))
            except ValueError:
                detail = ""
            return templates.TemplateResponse(
                request=request,
                name="cases_langfuse.html",
                status_code=response.status_code,
                context={
                    "agents": _list_agents(),
                    "connections": _langfuse_connections(),
                    "error": detail or "LANGFUSE_IMPORT_FAILED",
                    "preview": None,
                    "form": {
                        "agentId": agent_id,
                        "domainId": domain_id,
                        "connectionId": connection_id,
                        "fromStartTime": from_start_time,
                        "toStartTime": to_start_time,
                        "limit": limit,
                    },
                },
            )
        preview = response.json()
        return templates.TemplateResponse(
            request=request,
            name="cases_langfuse.html",
            context={
                "agents": _list_agents(),
                "connections": _langfuse_connections(),
                "error": None,
                "preview": preview,
                "form": {
                    "agentId": agent_id,
                    "domainId": domain_id,
                    "connectionId": connection_id,
                    "fromStartTime": from_start_time,
                    "toStartTime": to_start_time,
                    "limit": limit,
                },
            },
        )

    @router.get("/cases/langfuse", response_class=HTMLResponse)
    async def langfuse_page(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request=request,
            name="cases_langfuse.html",
            context={
                "agents": _list_agents(),
                "connections": _langfuse_connections(),
                "error": None,
                "preview": None,
                "form": None,
            },
        )

    @router.post("/cases/langfuse/confirm")
    async def confirm_langfuse_form(
        request: Request,
        preview_id: str = Form(),
        trace_ids: list[str] = Form(default=[]),
    ) -> RedirectResponse:
        import httpx

        if not trace_ids:
            return RedirectResponse("/cases/langfuse?error=selection", status_code=303)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://harness.local") as client:
            response = await client.post(
                "/api/v1/cases/import-langfuse/confirm",
                json={"previewId": preview_id, "traceIds": list(trace_ids)},
            )
        if response.status_code != 201:
            return RedirectResponse("/cases/langfuse?error=confirm", status_code=303)
        imported = int(response.json().get("imported", 0))
        return RedirectResponse("/cases?" + urlencode({"imported": imported}), status_code=303)

    def _store_case(
        case_id: str,
        agent_id: str,
        domain_id: str,
        content: str,
        session_id: str,
        similarity_group: str,
        created_at: str,
    ) -> None:
        import json

        from harness_lab.domain.models.case import CaseRecord

        record = CaseRecord.model_validate(
            {
                "id": case_id,
                "agentId": agent_id,
                "domainId": domain_id,
                "sessionId": session_id,
                "similarityGroup": similarity_group,
                "content": content,
                "source": "manual",
                "createdAt": created_at,
            }
        )
        payload = json.dumps(record.model_dump(by_alias=True), separators=(",", ":"), ensure_ascii=False)
        services.database.prepare(
            "INSERT INTO cases (id, agent_id, domain_id, created_at, payload_json) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, domain_id = excluded.domain_id, "
            "payload_json = excluded.payload_json"
        ).run(case_id, agent_id, domain_id, created_at, payload)

    @router.post("/cases")
    async def create_case_form(
        case_id: str = Form(),
        agent_id: str = Form(),
        domain_id: str = Form(),
        content: str = Form(),
        session_id: str = Form(default=""),
        similarity_group: str = Form(default=""),
    ) -> RedirectResponse:
        normalized_case_id = case_id.strip()
        session = session_id.strip() or normalized_case_id
        similarity = similarity_group.strip() or normalized_case_id
        _store_case(
            normalized_case_id,
            agent_id.strip(),
            domain_id.strip(),
            content.strip(),
            session,
            similarity,
            _utc_now(),
        )
        return RedirectResponse("/cases?created=case", status_code=303)

    @router.post("/cases/{case_id}/update")
    async def update_case_form(
        case_id: str,
        agent_id: str = Form(),
        domain_id: str = Form(),
        content: str = Form(),
        session_id: str = Form(default=""),
        similarity_group: str = Form(default=""),
    ) -> RedirectResponse:
        created_row = services.database.prepare(
            "SELECT created_at FROM cases WHERE id = ?"
        ).get(case_id)
        created_at = str(created_row[0]) if created_row is not None else _utc_now()
        session = session_id.strip() or case_id
        similarity = similarity_group.strip() or case_id
        _store_case(
            case_id,
            agent_id.strip(),
            domain_id.strip(),
            content.strip(),
            session,
            similarity,
            created_at,
        )
        return RedirectResponse("/cases?updated=case", status_code=303)

    @router.post("/cases/{case_id}/delete")
    async def delete_case_form(case_id: str) -> RedirectResponse:
        services.database.prepare("DELETE FROM cases WHERE id = ?").run(case_id)
        return RedirectResponse("/cases?deleted=case", status_code=303)

    @router.get("/connections", response_class=HTMLResponse)
    async def connections_page(request: Request) -> HTMLResponse:
        rows = services.database.prepare(
            "SELECT c.id, c.kind, c.name, "
            "CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS configured "
            "FROM connection_registrations c "
            "LEFT JOIN encrypted_secrets s ON s.id = c.id "
            "ORDER BY c.name COLLATE NOCASE, c.id"
        ).all()
        return templates.TemplateResponse(
            request=request,
            name="connections.html",
            context={"connections": [dict(row) for row in rows]},
        )

    def _resolve_codec() -> SecretBoxCodec:
        import base64
        import hashlib
        import os

        encoded = os.environ.get("HARNESS_MASTER_KEY")
        if not encoded:
            seed = os.environ.get("DATABASE_PATH", "harness-lab-local").encode("utf-8")
            encoded = base64.b64encode(hashlib.sha256(seed).digest()).decode("ascii")
        return SecretBoxCodec(encoded)

    @router.post("/connections")
    async def create_connection_form(
        connection_id: str = Form(),
        kind: str = Form(),
        name: str = Form(),
        credentials_json: str = Form(),
    ) -> RedirectResponse:
        import json

        try:
            credentials = json.loads(credentials_json)
        except ValueError:
            return RedirectResponse("/connections?error=credentials", status_code=303)
        if not isinstance(credentials, dict) or not credentials:
            return RedirectResponse("/connections?error=credentials", status_code=303)

        request: dict[str, object] = {
            "id": connection_id.strip(),
            "kind": kind.strip(),
            "name": name.strip(),
            "credentials": {str(key): str(value) for key, value in credentials.items()},
            "idempotency_key": None,
        }

        if services.register_connection is not None:
            try:
                await services.register_connection.execute(request)
            except Exception:
                return RedirectResponse("/connections?error=connection", status_code=303)
            return RedirectResponse("/connections?created=connection", status_code=303)

        from harness_lab.adapters.sqlite.connection_registration_store import (
            SqliteConnectionRegistrationStore,
        )

        store = SqliteConnectionRegistrationStore(services.database, _resolve_codec())
        try:
            await store.register(request)
        except Exception:
            return RedirectResponse("/connections?error=connection", status_code=303)
        return RedirectResponse("/connections?created=connection", status_code=303)

    @router.post("/connections/{connection_id}/update")
    async def update_connection_form(connection_id: str, name: str = Form()) -> RedirectResponse:
        services.database.prepare(
            "UPDATE connection_registrations SET name = ?, updated_at = ? WHERE id = ?"
        ).run(name.strip(), _utc_now(), connection_id)
        return RedirectResponse("/connections?updated=connection", status_code=303)

    @router.post("/connections/{connection_id}/delete")
    async def delete_connection_form(connection_id: str) -> RedirectResponse:
        def operation() -> None:
            services.database.prepare(
                "DELETE FROM connection_registrations WHERE id = ?"
            ).run(connection_id)
            services.database.prepare("DELETE FROM encrypted_secrets WHERE id = ?").run(connection_id)

        services.database.transaction(operation)()
        return RedirectResponse("/connections?deleted=connection", status_code=303)

    @router.get("/rounds", response_class=HTMLResponse)
    async def rounds_page(request: Request) -> HTMLResponse:
        agents = services.database.prepare(
            "SELECT id, domain_id AS domainId, name FROM agents ORDER BY name COLLATE NOCASE, id"
        ).all()
        rounds = await services.repository.list_rounds()
        return templates.TemplateResponse(
            request=request,
            name="rounds.html",
            context={"agents": [dict(row) for row in agents], "rounds": rounds},
        )

    @router.post("/rounds")
    async def create_round_form(
        round_id: str = Form(), agent_id: str = Form(), domain_id: str = Form(), objective: str = Form()
    ) -> RedirectResponse:
        import httpx

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://harness.local") as client:
            response = await client.post(
                "/api/v1/rounds",
                json={"id": round_id, "agentId": agent_id, "domainId": domain_id, "objective": objective},
            )
        target = f"/rounds/{round_id}" if response.status_code == 201 else "/rounds?error=round"
        return RedirectResponse(target, status_code=303)

    @router.get("/rounds/{round_id}", response_class=HTMLResponse)
    async def round_detail(request: Request, round_id: str) -> HTMLResponse:
        round_obj = await services.repository.get_round(round_id)
        if round_obj is None:
            return templates.TemplateResponse(request=request, name="not_found.html", status_code=404)
        events = await services.repository.list_events(round_id, -1)
        artifact = await services.artifacts.get(round_id)
        result: dict[str, object] | None = None
        if artifact is not None:
            evaluation = artifact.get("evaluation")
            if isinstance(evaluation, dict):
                result = {
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
        return templates.TemplateResponse(
            request=request,
            name="round_detail.html",
            context={"round": round_obj, "events": events, "artifact": artifact, "result": result},
        )

    @router.post("/rounds/{round_id}/cancel")
    async def cancel_round_form(round_id: str) -> RedirectResponse:
        now = __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat().replace("+00:00", "Z")
        services.jobs.request_cancellation(round_id, now)
        return RedirectResponse(f"/rounds/{round_id}", status_code=303)

    app.include_router(router)