from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from harness_lab.adapters.sqlite.client import open_sqlite_database
from harness_lab.adapters.sqlite.round_artifact_store import SqliteRoundArtifactStore
from harness_lab.adapters.sqlite.run_repository import SqliteRunRepository
from harness_lab.domain.models.round import Round


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def _setup_round(database: object, round_id: str) -> None:
    database.prepare("INSERT OR IGNORE INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "domain-1",
        "Agent",
        "2026-11-05T10:00:00.000Z",
    )
    _run(
        SqliteRunRepository(database).save_round(
            Round(
                id=round_id,
                agent_id="agent-1",
                domain_id="domain-1",
                state="collecting",
                objective="Improve",
                created_at="2026-11-05T10:00:00.000Z",
                updated_at="2026-11-05T10:00:00.000Z",
            )
        )
    )


def _session(case_id: str) -> dict[str, object]:
    return {
        "cases": [{"id": case_id, "sessionId": "s1", "similarityGroup": "g1", "content": "question"}],
        "partition": {
            "version": 1,
            "seed": "seed",
            "diagnosisIds": [case_id],
            "reservedIds": [],
            "createdAt": "2026-11-05T10:00:00.000Z",
        },
        "baseline": {
            "id": "snapshot-1",
            "agentId": "agent-1",
            "domainId": "domain-1",
            "version": "1",
            "components": {},
            "immutableConstraints": [],
            "createdAt": "2026-11-05T10:00:00.000Z",
        },
        "capabilities": {
            "editableComponents": [],
            "supportsSeed": False,
            "supportsToolReplay": False,
        },
        "diagnosis": {"evidence": [], "findings": [], "hypotheses": [], "actionability": []},
        "refinement": {
            "candidates": [],
            "composed": None,
            "rejected": [],
            "lessons": [],
            "stopReason": "completed",
        },
        "reservedExecutions": [],
        "evaluation": None,
    }


def test_round_artifact_v1_roundtrip_and_upsert(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _setup_round(database, "round-1")
    _setup_round(database, "round-2")
    store = SqliteRoundArtifactStore(database)

    first = _session("case-1")
    updated = _session("case-2")
    other = _session("case-other")
    _run(store.save("round-1", first))
    _run(store.save("round-1", updated))
    _run(store.save("round-2", other))

    assert _run(store.get("round-1")) == updated
    assert _run(store.get("round-2")) == other
    database.close()


def test_round_artifact_rejects_unknown_version_and_malformed_payload(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _setup_round(database, "round-1")
    store = SqliteRoundArtifactStore(database)
    _run(store.save("round-1", _session("case-1")))

    database.prepare(
        "UPDATE round_artifacts SET payload_version = 2 WHERE round_id = ?"
    ).run("round-1")
    with pytest.raises(ValueError, match="ROUND_ARTIFACT_VERSION_UNSUPPORTED"):
        _run(store.get("round-1"))

    database.prepare(
        "UPDATE round_artifacts SET payload_version = 1, payload_json = ? WHERE round_id = ?"
    ).run("{}", "round-1")
    with pytest.raises(Exception):
        _run(store.get("round-1"))
    database.close()