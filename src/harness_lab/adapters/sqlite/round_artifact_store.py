from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .client import SqliteDatabase


class _Case(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    sessionId: str
    similarityGroup: str
    content: str


class _Partition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    seed: str
    diagnosisIds: list[str]
    reservedIds: list[str]
    createdAt: str


class _Baseline(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    agentId: str
    domainId: str
    version: str
    components: dict[str, str]
    immutableConstraints: list[str]
    createdAt: str
    sourceVersion: str | None = Field(default=None, exclude_if=lambda value: value is None)
    artifactHash: str | None = Field(default=None, exclude_if=lambda value: value is None)
    opaquePayload: dict[str, Any] | None = Field(default=None, exclude_if=lambda value: value is None)


class _Capabilities(BaseModel):
    model_config = ConfigDict(extra="forbid")
    editableComponents: list[str]
    supportsSeed: bool
    supportsToolReplay: bool


class _Diagnosis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence: list[Any]
    findings: list[Any]
    hypotheses: list[Any]
    actionability: list[Any]


class _Refinement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidates: list[Any]
    composed: Any | None
    rejected: list[Any]
    lessons: list[Any]
    stopReason: Literal["completed", "proposal_limit_reached"]


class _Session(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cases: list[_Case]
    partition: _Partition
    baseline: _Baseline
    capabilities: _Capabilities
    diagnosis: _Diagnosis
    refinement: _Refinement
    reservedExecutions: list[dict[str, Any]]
    evaluation: Any | None


class SqliteRoundArtifactStore:
    def __init__(self, database: SqliteDatabase) -> None:
        self._database = database

    async def get(self, round_id: str) -> dict[str, Any] | None:
        row = self._database.prepare(
            "SELECT payload_version, payload_json FROM round_artifacts WHERE round_id = ?"
        ).get(round_id)
        if row is None:
            return None
        if int(row[0]) != 1:
            raise ValueError("ROUND_ARTIFACT_VERSION_UNSUPPORTED")
        parsed = _Session.model_validate(json.loads(str(row[1])))
        return parsed.model_dump(by_alias=True)

    async def save(self, round_id: str, session: dict[str, Any]) -> None:
        payload = json.dumps(
            _Session.model_validate(session).model_dump(by_alias=True),
            separators=(",", ":"),
        )

        def operation() -> None:
            self._database.prepare(
                """INSERT INTO round_artifacts (round_id, payload_version, payload_json, updated_at)
                VALUES (?, 1, ?, ?)
                ON CONFLICT(round_id) DO UPDATE SET
                  payload_version = excluded.payload_version,
                  payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at"""
            ).run(round_id, payload, datetime.now(UTC).isoformat().replace("+00:00", "Z"))

        self._database.transaction(operation)()
        await self._database.flush()
