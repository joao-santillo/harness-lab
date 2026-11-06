from __future__ import annotations

from fastapi.testclient import TestClient

from harness_lab.adapters.langfuse import (
    LangfuseCaseImportCandidate,
    LangfuseCaseImportResult,
    LangfuseTraceRecoveryItem,
)
from harness_lab.api import create_app
from harness_lab.api.app import create_default_services


def test_agents_cases_and_rounds_expose_public_contract() -> None:
    services = create_default_services()
    app = create_app(services)
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/agents",
            json={"id": "agent-one", "domainId": "domain-one", "name": " Agent One "},
        )
        assert created.status_code == 201
        assert created.json()["name"] == "Agent One"
        assert "credentials" not in created.json()

        cases = []
        for index in range(2):
            cases.append(
                {
                    "id": f"case-{index}",
                    "agentId": "agent-one",
                    "domainId": "domain-one",
                    "sessionId": f"session-{index}",
                    "similarityGroup": f"group-{index}",
                    "content": f"question {index}",
                    "source": "manual",
                    "createdAt": "2026-11-06T10:00:00.000Z",
                }
            )
        for case in cases:
            services.database.prepare(
                "INSERT INTO cases (id, agent_id, domain_id, created_at, payload_version, payload_json) "
                "VALUES (?, ?, ?, ?, 1, ?)"
            ).run(
                case["id"],
                case["agentId"],
                case["domainId"],
                case["createdAt"],
                __import__("json").dumps(case, separators=(",", ":")),
            )

        listed = client.get("/api/v1/cases", params={"agentId": "agent-one", "domainId": "domain-one"})
        assert listed.status_code == 200
        assert len(listed.json()["items"]) == 2

        round_response = client.post(
            "/api/v1/rounds",
            json={
                "id": "round-one",
                "agentId": "agent-one",
                "domainId": "domain-one",
                "objective": "Improve answers",
            },
        )
        assert round_response.status_code == 201
        assert round_response.json()["state"] == "setup"
        assert services.jobs.claim_next("worker-one", "2026-11-06T10:01:00.000Z")["roundId"] == "round-one"
        duplicate = client.post(
            "/api/v1/rounds",
            json={
                "id": "round-one",
                "agentId": "agent-one",
                "domainId": "domain-one",
                "objective": "Different objective",
            },
        )
        assert duplicate.status_code == 409

        cancelled = client.post("/api/v1/rounds/round-one/cancel")
        assert cancelled.status_code == 202

    services.database.close()


def test_csv_and_langfuse_preview_import_contract() -> None:
    services = create_default_services()
    recoveries = 0

    async def recover(_request: dict[str, object]) -> LangfuseCaseImportResult:
        nonlocal recoveries
        recoveries += 1
        candidate = LangfuseCaseImportCandidate(
            trace_id="trace-1",
            session_id="session-1",
            similarity_group="support-flow",
            content="How do I reset access?",
            start_time="2026-11-03T10:00:00.000Z",
        )
        return LangfuseCaseImportResult(
            items=(LangfuseTraceRecoveryItem(status="ready", trace_id="trace-1", candidate=candidate),),
            limitations=(),
        )

    services.recover_langfuse_cases = recover
    app = create_app(services)
    with TestClient(app) as client:
        for agent_id, domain_id in (("csv-agent", "csv-domain"), ("langfuse-agent", "langfuse-domain")):
            response = client.post(
                "/api/v1/agents",
                json={"id": agent_id, "domainId": domain_id, "name": agent_id},
            )
            assert response.status_code == 201

        csv_response = client.post(
            "/api/v1/cases/import-csv",
            json={
                "agentId": "csv-agent",
                "domainId": "csv-domain",
                "csv": 'id,sessionId,similarityGroup,content\r\ncase-csv,s-1,g-1,"Question, with comma"',
            },
        )
        assert csv_response.status_code == 201, csv_response.json()
        assert csv_response.json() == {"imported": 1}

        preview = client.post(
            "/api/v1/cases/import-langfuse/preview",
            json={
                "agentId": "langfuse-agent",
                "domainId": "langfuse-domain",
                "connectionId": "langfuse-main",
                "fromStartTime": "2026-11-03T00:00:00.000Z",
                "toStartTime": "2026-11-04T00:00:00.000Z",
                "limit": 20,
            },
        )
        assert preview.status_code == 200
        assert preview.json()["summary"] == {"total": 1, "ready": 1, "existing": 0, "discarded": 0}
        preview_id = preview.json()["previewId"]

        confirmed = client.post(
            "/api/v1/cases/import-langfuse/confirm",
            json={"previewId": preview_id, "traceIds": ["trace-1"]},
        )
        assert confirmed.status_code == 201
        assert confirmed.json() == {"imported": 1, "skipped": 0}
        assert recoveries == 1

    services.database.close()


def test_connection_metadata_and_credential_status_never_expose_secrets() -> None:
    services = create_default_services()
    services.database.prepare(
        "INSERT INTO encrypted_secrets (id, key_version, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("langfuse-main", "v1", "nonce-secret", "ciphertext-secret", "now")
    services.database.prepare(
        "INSERT INTO connection_registrations "
        "(id, kind, name, request_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("langfuse-main", "langfuse", "Langfuse principal", "hash", "now", "now")
    app = create_app(services)

    with TestClient(app) as client:
        listed = client.get("/api/v1/connections")
        detail = client.get("/api/v1/connections/langfuse-main")
        credential_status = client.get("/api/v1/connections/langfuse-main/credentials")
        missing = client.get("/api/v1/connections/missing")
        deleted = client.delete("/api/v1/connections/langfuse-main")
        secret_after_delete = services.database.prepare(
            "SELECT 1 FROM encrypted_secrets WHERE id = ?"
        ).get("langfuse-main")

    assert listed.status_code == 200
    assert detail.status_code == 200
    assert detail.json() == {
        "id": "langfuse-main",
        "kind": "langfuse",
        "name": "Langfuse principal",
        "configured": True,
    }
    assert credential_status.json() == {"connectionId": "langfuse-main", "configured": True}
    assert "secret" not in str((listed.json(), detail.json(), credential_status.json())).lower()
    assert missing.status_code == 404
    assert deleted.status_code == 204
    assert secret_after_delete is None
    services.database.close()