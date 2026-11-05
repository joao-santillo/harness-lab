from __future__ import annotations

import inspect

from harness_lab.domain.models.evaluation import EvaluationResult
from harness_lab.domain.models.harness import Candidate, HarnessSnapshot
from harness_lab.domain.models.round import Round, RoundCheckpoint, RoundProgressEvent
from harness_lab.domain.ports import (
    CandidateArtifactExportRequest,
    CandidateVersionExecutionRequest,
    ReportArtifactExportRequest,
    RoundProgressCommit,
    SecretValue,
    parse_candidate_execution_request,
)


def test_round_progress_commit_contract_shape() -> None:
    commit = RoundProgressCommit(
        round=Round(
            id="round-1",
            agent_id="agent-1",
            domain_id="domain-1",
            state="setup",
            objective="Objective",
            created_at="2026-11-05T00:00:00.000Z",
            updated_at="2026-11-05T00:00:00.000Z",
        ),
        checkpoint=RoundCheckpoint(
            id="ckpt-1",
            round_id="round-1",
            state="setup",
            sequence=1,
            created_at="2026-11-05T00:00:00.000Z",
        ),
        event=RoundProgressEvent(
            id="evt-1",
            round_id="round-1",
            sequence=1,
            event="collection_started",
            state="collecting",
            occurred_at="2026-11-05T00:01:00.000Z",
            message_code="round.collection_started",
        ),
    )

    payload = commit.model_dump(by_alias=True)
    assert payload["round"]["state"] == "setup"
    assert payload["checkpoint"]["roundId"] == "round-1"
    assert payload["event"]["roundId"] == "round-1"


def test_candidate_execution_request_discriminates_kinds() -> None:
    baseline = parse_candidate_execution_request(
        {
            "kind": "baseline",
            "roundId": "round-1",
            "caseId": "case-1",
            "harnessVersionId": "snapshot-1",
            "attempt": 1,
            "idempotencyKey": "round-1:case-1:baseline:1",
        }
    )

    candidate = parse_candidate_execution_request(
        {
            "kind": "candidate",
            "candidateId": "candidate-1",
            "roundId": "round-1",
            "caseId": "case-1",
            "harnessVersionId": "snapshot-1",
            "attempt": 1,
            "idempotencyKey": "round-1:case-1:candidate-1:1",
        }
    )

    assert baseline.kind == "baseline"
    assert not hasattr(baseline, "candidate_id")
    assert isinstance(candidate, CandidateVersionExecutionRequest)
    assert candidate.candidate_id == "candidate-1"


def test_artifact_requests_distinguish_candidate_and_report_payloads() -> None:
    round_obj = Round(
        id="round-1",
        agent_id="agent-1",
        domain_id="domain-1",
        state="evaluating",
        objective="Objective",
        created_at="2026-11-05T00:00:00.000Z",
        updated_at="2026-11-05T00:00:00.000Z",
    )
    evidence = []

    candidate_request = CandidateArtifactExportRequest(
        kind="candidate",
        round=round_obj,
        evidence=evidence,
        candidate=Candidate(
            id="candidate-1",
            round_id="round-1",
            baseline_id="snapshot-1",
            snapshot=HarnessSnapshot(
                id="snapshot-1",
                agent_id="agent-1",
                domain_id="domain-1",
                version="v1",
                components={"planner": "prompt-v1"},
                immutable_constraints=("no-pii",),
                created_at="2026-11-05T00:00:00.000Z",
            ),
            changes=(),
            hypothesis_ids=(),
            evidence_ids=(),
        ),
        evaluation=EvaluationResult(
            id="eval-1",
            round_id="round-1",
            candidate_id="candidate-1",
            decision="recommended",
            sample_size=10,
            confidence=0.92,
            aggregate_score_change=0.11,
            cost_change=-0.03,
            latency_change=-15.2,
            cases=(),
            limitations=(),
            rationale="All metrics improved.",
        ),
    )

    report_request = ReportArtifactExportRequest(
        kind="report",
        round=round_obj,
        evidence=evidence,
        decision="recommended",
    )

    assert candidate_request.kind == "candidate"
    assert candidate_request.evaluation.decision == "recommended"
    assert report_request.kind == "report"
    assert not hasattr(report_request, "candidate")


def test_secret_value_repr_does_not_expose_secret_value() -> None:
    secret = SecretValue(value="top-secret")
    assert "top-secret" not in repr(secret)


def test_domain_has_no_fastapi_sqlite_or_adapter_imports() -> None:
    import harness_lab.domain as domain_pkg
    import harness_lab.domain.models as models_pkg
    import harness_lab.domain.ports as ports_mod

    domain_src = inspect.getsource(domain_pkg)
    ports_src = inspect.getsource(ports_mod)
    models_src = inspect.getsource(models_pkg)

    forbidden = ("fastapi", "sqlite", "adapters", "httpx")
    for token in forbidden:
        assert token not in domain_src
        assert token not in ports_src
        assert token not in models_src
