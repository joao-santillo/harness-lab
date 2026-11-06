from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from harness_lab.adapters.langfuse import LangfuseCaseImportResult, LangfuseImportPreviewStore
from harness_lab.adapters.sqlite import (
    SqliteCaseRepository,
    SqliteRoundArtifactStore,
    SqliteRoundJobStore,
    SqliteRunRepository,
)
from harness_lab.application.connections import RegisterConnection


@dataclass
class ApiServices:
    database: Any
    repository: SqliteRunRepository
    cases: SqliteCaseRepository
    jobs: SqliteRoundJobStore
    artifacts: SqliteRoundArtifactStore
    register_connection: RegisterConnection | None = None
    langfuse_previews: LangfuseImportPreviewStore | None = None
    recover_langfuse_cases: Callable[[dict[str, object]], Awaitable[LangfuseCaseImportResult]] | None = None