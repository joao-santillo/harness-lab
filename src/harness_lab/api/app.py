from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from harness_lab.adapters.langfuse import LangfuseImportPreviewStore
from harness_lab.adapters.langfuse.recovery import build_recover_langfuse_cases
from harness_lab.adapters.sqlite import (
    SqliteCaseRepository,
    SqliteRoundArtifactStore,
    SqliteRoundJobStore,
    SqliteRunRepository,
    open_sqlite_database,
)
from harness_lab.web.app import register_web_routes

from .errors import ApiError
from .i18n import localize
from .routes.agents import register_agent_routes
from .routes.cases import register_case_routes
from .routes.connections import register_connection_routes
from .routes.events import register_event_routes
from .routes.rounds import register_round_routes
from .services import ApiServices


def create_default_services(database_path: str = ":memory:") -> ApiServices:
    database = open_sqlite_database(database_path)
    return ApiServices(
        database=database,
        repository=SqliteRunRepository(database),
        cases=SqliteCaseRepository(database),
        jobs=SqliteRoundJobStore(database),
        artifacts=SqliteRoundArtifactStore(database),
        langfuse_previews=LangfuseImportPreviewStore(),
        recover_langfuse_cases=build_recover_langfuse_cases(database),
    )


def create_app(services: ApiServices | None = None, *, close_services: bool = True) -> FastAPI:
    owned_services = services is None
    effective = services or create_default_services()
    app = FastAPI(title="Harness Lab API", version="1")
    app.state.services = effective
    app.mount("/static", StaticFiles(directory="src/harness_lab/web/static"), name="static")

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={
                "code": error.code,
                "message": error.message or localize(error.code, request.headers.get("accept-language")),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"code": "REQUEST_INVALID", "message": localize("REQUEST_FAILED", request.headers.get("accept-language"))},
        )

    @app.exception_handler(Exception)
    async def handle_unknown_error(request: Request, _error: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={"code": "REQUEST_FAILED", "message": localize("REQUEST_FAILED", request.headers.get("accept-language"))},
        )

    register_agent_routes(app, effective)
    register_case_routes(app, effective)
    register_connection_routes(app, effective)
    register_round_routes(app, effective)
    register_event_routes(app, effective)
    register_web_routes(app, effective)

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("shutdown")
    async def shutdown() -> None:
        if close_services or owned_services:
            effective.database.close()

    @app.exception_handler(404)
    async def handle_not_found(request: Request, _error: Any) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"code": "ROUTE_NOT_FOUND", "message": localize("ROUTE_NOT_FOUND", request.headers.get("accept-language"))},
        )

    return app