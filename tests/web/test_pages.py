from __future__ import annotations

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
    assert 'aria-label="Navegacao principal"' in response.text
    assert "Agent One" in response.text
    assert "credentials" not in response.text
    assert styles.status_code == 200
    assert "prefers-reduced-motion" in styles.text
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