from __future__ import annotations

from harness_lab.adapters.langfuse.normalize import normalize_observations


def test_normalize_observations_dedupes_and_reports_limitations() -> None:
    result = normalize_observations(
        "project-1",
        (
            {
                "id": "root-1",
                "traceId": "trace-1",
                "parentObservationId": None,
                "type": "SPAN",
                "input": {"prompt": "hello"},
                "output": "ok",
                "startTime": "2026-10-31T00:00:00Z",
                "endTime": "2026-10-31T00:00:01Z",
            },
            {
                "id": "child-1",
                "traceId": "trace-1",
                "parentObservationId": "missing",
                "type": "GENERATION",
                "startTime": "2026-10-31T00:00:02Z",
                "endTime": None,
            },
            {
                "id": "child-1",
                "traceId": "trace-1",
                "parentObservationId": "missing",
                "type": "GENERATION",
                "startTime": "2026-10-31T00:00:02Z",
                "endTime": None,
            },
            {
                "id": "root-2",
                "traceId": "trace-1",
                "parentObservationId": None,
                "type": "EVENT",
                "startTime": "2026-10-31T00:00:03Z",
                "endTime": "2026-10-31T00:00:03Z",
            },
        ),
    )

    assert len(result.observations) == 3
    assert result.logical_root_ids == ("root-1", "child-1", "root-2")
    assert "Observation child-1 references missing parent missing." in result.limitations
    assert "Trace trace-1 has multiple logical roots." in result.limitations
    assert "Observation root-1 has missing usage or cost metrics." in result.limitations
    assert result.observations[0].latency_ms == 1000
