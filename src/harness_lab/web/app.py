from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from harness_lab.api.services import ApiServices


def register_web_routes(app: FastAPI, services: ApiServices) -> None:
    templates = Jinja2Templates(directory=Path(__file__).with_name("templates"))
    router = APIRouter(tags=["web"])

    @router.get("/", response_class=HTMLResponse)
    async def home(request: Request) -> HTMLResponse:
        agents = services.database.prepare(
            "SELECT id, domain_id AS domainId, name FROM agents ORDER BY name COLLATE NOCASE, id"
        ).all()
        return templates.TemplateResponse(
            request=request,
            name="home.html",
            context={"agents": [dict(agent) for agent in agents]},
        )

    @router.post("/agents")
    async def create_agent(
        agent_id: str = Form(), domain_id: str = Form(), name: str = Form()
    ) -> RedirectResponse:
        now = __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat().replace("+00:00", "Z")
        services.database.prepare(
            "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
        ).run(agent_id.strip(), domain_id.strip(), name.strip(), now)
        return RedirectResponse("/?created=agent", status_code=303)

    @router.get("/cases", response_class=HTMLResponse)
    async def cases_page(request: Request) -> HTMLResponse:
        agents = services.database.prepare(
            "SELECT id, domain_id AS domainId, name FROM agents ORDER BY name COLLATE NOCASE, id"
        ).all()
        cases = services.database.prepare(
            "SELECT id, agent_id AS agentId, domain_id AS domainId, payload_json FROM cases ORDER BY created_at DESC, id"
        ).all()
        return templates.TemplateResponse(
            request=request,
            name="cases.html",
            context={"agents": [dict(row) for row in agents], "cases": [dict(row) for row in cases]},
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

    @router.get("/connections", response_class=HTMLResponse)
    async def connections_page(request: Request) -> HTMLResponse:
        rows = services.database.prepare(
            "SELECT id, kind, name FROM connection_registrations ORDER BY name COLLATE NOCASE, id"
        ).all()
        return templates.TemplateResponse(
            request=request,
            name="connections.html",
            context={"connections": [dict(row) for row in rows]},
        )

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
        return templates.TemplateResponse(
            request=request,
            name="round_detail.html",
            context={"round": round_obj, "events": events, "artifact": artifact},
        )

    @router.post("/rounds/{round_id}/cancel")
    async def cancel_round_form(round_id: str) -> RedirectResponse:
        now = __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat().replace("+00:00", "Z")
        services.jobs.request_cancellation(round_id, now)
        return RedirectResponse(f"/rounds/{round_id}", status_code=303)

    app.include_router(router)