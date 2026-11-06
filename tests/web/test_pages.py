from __future__ import annotations

import json

from fastapi.testclient import TestClient

from harness_lab.api import create_app
from harness_lab.api.app import create_default_services


def test_home_page_has_accessible_shell_and_public_agent_data() -> None:
    services = create_default_services()
    services.database.prepare(
        "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
    ).run("agent-one", "domain-one", "Agent One", "2026-11-06T10:00:00.000Z")

    with TestClient(create_app(services)) as client:
        response = client.get("/")
        styles = client.get("/static/styles.css")

    assert response.status_code == 200
    assert 'id="main-content"' in response.text
    assert 'aria-label="Navegação principal"' in response.text
    assert "Agent One" in response.text
    assert "credentials" not in response.text
    assert styles.status_code == 200
    assert "prefers-reduced-motion" in styles.text
    services.database.close()


def test_home_page_demonstrates_business_value_and_live_operation() -> None:
    services = create_default_services()
    services.database.prepare(
        "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
    ).run("agent-one", "domain-one", "Agent One", "2026-11-06T10:00:00.000Z")
    services.database.prepare(
        "INSERT INTO cases (id, agent_id, domain_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?)"
    ).run("case-one", "agent-one", "domain-one", "2026-11-06T10:00:00.000Z", "{}")

    with TestClient(create_app(services)) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert "Transforme melhoria de agentes em engenharia mensurável" in response.text
    assert "11 tipos de falha" in response.text
    assert "Avaliação cega" in response.text
    assert "1 agente" in response.text
    assert "1 case" in response.text
    assert 'href="/workspace/agents"' in response.text
    services.database.close()


def test_operator_can_manage_agents_cases_and_connections() -> None:
    services = create_default_services()

    with TestClient(create_app(services), follow_redirects=True) as client:
        created_agent = client.post(
            "/agents",
            data={"agent_id": "support-agent", "domain_id": "retail", "name": "Support"},
        )
        assert created_agent.status_code == 200

        updated_agent = client.post(
            "/agents/support-agent/update",
            data={"domain_id": "commerce", "name": "Support Prime"},
        )
        assert updated_agent.status_code == 200
        assert "Support Prime" in updated_agent.text

        created_case = client.post(
            "/cases",
            data={
                "case_id": "case-manual",
                "agent_id": "support-agent",
                "domain_id": "commerce",
                "content": "Reset access",
                "session_id": "session-1",
                "similarity_group": "access",
            },
        )
        assert created_case.status_code == 200
        assert "Reset access" in created_case.text

        updated_case = client.post(
            "/cases/case-manual/update",
            data={
                "agent_id": "support-agent",
                "domain_id": "commerce",
                "content": "Restore access safely",
                "session_id": "session-1",
                "similarity_group": "access",
            },
        )
        assert updated_case.status_code == 200
        assert "Restore access safely" in updated_case.text

        connection = client.post(
            "/connections",
            data={
                "connection_id": "langfuse-main",
                "kind": "langfuse",
                "name": "Langfuse principal",
                "credentials_json": json.dumps(
                    {
                        "baseUrl": "https://langfuse.example",
                        "publicKey": "pk_test",
                        "secretKey": "sk_test",
                    }
                ),
            },
        )
        assert connection.status_code == 200
        assert "Langfuse principal" in connection.text
        assert "sk_test" not in connection.text

        renamed_connection = client.post(
            "/connections/langfuse-main/update",
            data={"name": "Langfuse producao"},
        )
        assert renamed_connection.status_code == 200
        assert "Langfuse producao" in renamed_connection.text

        deleted_connection = client.post("/connections/langfuse-main/delete")
        assert deleted_connection.status_code == 200
        assert "Langfuse producao" not in deleted_connection.text

        deleted_case = client.post("/cases/case-manual/delete")
        assert deleted_case.status_code == 200
        assert "Restore access safely" not in deleted_case.text

        deleted_agent = client.post("/agents/support-agent/delete")
        assert deleted_agent.status_code == 200
        assert "Support Prime" not in deleted_agent.text

    services.database.close()


def test_operator_can_create_agent_import_cases_and_start_round() -> None:
    services = create_default_services()

    with TestClient(create_app(services), follow_redirects=True) as client:
        agent = client.post(
            "/agents",
            data={"agent_id": "support-agent", "domain_id": "retail", "name": "Support"},
        )
        assert agent.status_code == 200
        assert "Support" in agent.text

        imported = client.post(
            "/cases/csv",
            data={
                "agent_id": "support-agent",
                "domain_id": "retail",
                "csv_content": (
                    "id,sessionId,similarityGroup,content\n"
                    "case-1,session-1,access,Reset access\n"
                    "case-2,session-2,billing,Second invoice"
                ),
            },
        )
        assert imported.status_code == 200
        assert "case-1" in imported.text
        assert "case-2" in imported.text

        round_page = client.post(
            "/rounds",
            data={
                "round_id": "round-web",
                "agent_id": "support-agent",
                "domain_id": "retail",
                "objective": "Improve support answers",
            },
        )
        assert round_page.status_code == 200
        assert "round-web" in round_page.text
        assert "Aguardando o worker" in round_page.text
        assert services.jobs.claim_next("web-test", "2026-11-06T12:00:00.000Z")["roundId"] == "round-web"

    services.database.close()