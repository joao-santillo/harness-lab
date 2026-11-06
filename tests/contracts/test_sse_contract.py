from __future__ import annotations

from fastapi.testclient import TestClient

from harness_lab.api import create_app
from harness_lab.api.app import create_default_services
from harness_lab.domain import Round, RoundProgressEvent


def test_sse_replays_events_and_emits_terminal_stream() -> None:
    services = create_default_services()
    app = create_app(services)
    now = "2026-11-06T10:00:00.000Z"
    services.database.prepare(
        "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
    ).run("agent-one", "domain-one", "Agent", now)
    round_obj = Round(
        id="round-one",
        agent_id="agent-one",
        domain_id="domain-one",
        state="recommended",
        objective="Improve",
        created_at=now,
        updated_at=now,
    )
    import asyncio

    asyncio.run(services.repository.save_round(round_obj))
    asyncio.run(
        services.repository.save_event(
            RoundProgressEvent(
                id="event-one",
                round_id=round_obj.id,
                sequence=0,
                event="recommendation_completed",
                state="recommended",
                occurred_at=now,
                message_code="ROUND_RECOMMENDATION_COMPLETED",
            )
        )
    )

    with TestClient(app) as client:
        response = client.get("/api/v1/rounds/round-one/events", headers={"Last-Event-ID": "not-a-number"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "id: 0\n" in response.text
    assert "event: round-progress\n" in response.text
    assert "recommendation_completed" in response.text
    assert ": heartbeat" not in response.text
    services.database.close()


def test_sse_last_event_id_does_not_replay_seen_events() -> None:
    services = create_default_services()
    app = create_app(services)
    now = "2026-11-06T10:00:00.000Z"
    services.database.prepare(
        "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
    ).run("agent-one", "domain-one", "Agent", now)
    round_obj = Round(
        id="round-resume",
        agent_id="agent-one",
        domain_id="domain-one",
        state="cancelled",
        objective="Improve",
        created_at=now,
        updated_at=now,
    )
    import asyncio

    asyncio.run(services.repository.save_round(round_obj))
    for sequence in range(2):
        asyncio.run(
            services.repository.save_event(
                RoundProgressEvent(
                    id=f"event-{sequence}",
                    round_id=round_obj.id,
                    sequence=sequence,
                    event="cancel_requested" if sequence else "diagnosis_started",
                    state="cancelled" if sequence else "diagnosing",
                    occurred_at=now,
                    message_code="ROUND_CANCELLED" if sequence else "ROUND_DIAGNOSIS_STARTED",
                )
            )
        )

    with TestClient(app) as client:
        response = client.get("/api/v1/rounds/round-resume/events", headers={"Last-Event-ID": "0"})

    assert response.status_code == 200
    assert "id: 0\n" not in response.text
    assert response.text.count("id: 1\n") == 1
    services.database.close()