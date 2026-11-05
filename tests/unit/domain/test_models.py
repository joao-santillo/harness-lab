from __future__ import annotations

import json
from pathlib import Path

import pytest

from harness_lab.domain.models.case import CaseRecord
from harness_lab.domain.models.evaluation import (
    CaseEvaluation,
    EvaluationResult,
    VersionedEvaluationResult,
)
from harness_lab.domain.models.evaluator import EvaluatorDefinition
from harness_lab.domain.models.evidence import (
    EvidenceExecution,
    EvidenceMissingData,
    EvidenceTrace,
    Finding,
    Hypothesis,
)
from harness_lab.domain.models.harness import (
    Candidate,
    CandidateChange,
    ExecutionMetrics,
    ExecutionResult,
    HarnessSnapshot,
)
from harness_lab.domain.models.partition import PartitionCase, PartitionManifest, PartitionOptions
from harness_lab.domain.models.round import Round, RoundCheckpoint, RoundProgressEvent

FIXTURE_PATH = Path("tests/contracts/fixtures/domain/models-roundtrip.json")


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _without_null_omissible_fields(payload: dict[str, object]) -> dict[str, object]:
    cleaned = json.loads(json.dumps(payload))

    snapshot = cleaned.get("harnessSnapshot")
    if isinstance(snapshot, dict):
        for field in ("sourceVersion", "artifactHash", "opaquePayload"):
            if snapshot.get(field) is None:
                snapshot.pop(field, None)

    candidate = cleaned.get("candidate")
    if isinstance(candidate, dict):
        candidate_snapshot = candidate.get("snapshot")
        if isinstance(candidate_snapshot, dict):
            for field in ("sourceVersion", "artifactHash", "opaquePayload"):
                if candidate_snapshot.get(field) is None:
                    candidate_snapshot.pop(field, None)

    case_record = cleaned.get("caseRecord")
    if isinstance(case_record, dict):
        for field in ("sourceReference", "syntheticLabel"):
            if case_record.get(field) is None:
                case_record.pop(field, None)

    partition_options = cleaned.get("partitionOptions")
    if isinstance(partition_options, dict) and partition_options.get("createdAt") is None:
        partition_options.pop("createdAt", None)

    return cleaned


def _normalize(value: object) -> object:
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_normalize(item) for item in value]
    return value


def _dump_alias(model: object) -> object:
    return _normalize(model.model_dump(by_alias=True))


def test_models_roundtrip_fixture_with_camel_case_aliases() -> None:
    fixture = _without_null_omissible_fields(_load_fixture())

    round_obj = Round.model_validate(fixture["round"])
    progress_obj = RoundProgressEvent.model_validate(fixture["roundProgressEvent"])
    checkpoint_obj = RoundCheckpoint.model_validate(fixture["roundCheckpoint"])

    partition_case_obj = PartitionCase.model_validate(fixture["partitionCase"])
    case_obj = CaseRecord.model_validate(fixture["caseRecord"])

    evidence_trace_obj = EvidenceTrace.model_validate(fixture["evidenceTrace"])
    evidence_execution_obj = EvidenceExecution.model_validate(fixture["evidenceExecution"])
    evidence_missing_data_obj = EvidenceMissingData.model_validate(fixture["evidenceMissingData"])
    finding_obj = Finding.model_validate(fixture["finding"])
    hypothesis_obj = Hypothesis.model_validate(fixture["hypothesis"])

    snapshot_obj = HarnessSnapshot.model_validate(fixture["harnessSnapshot"])
    candidate_change_obj = CandidateChange.model_validate(fixture["candidateChange"])
    candidate_obj = Candidate.model_validate(fixture["candidate"])
    execution_metrics_obj = ExecutionMetrics.model_validate(fixture["executionMetrics"])
    execution_result_obj = ExecutionResult.model_validate(fixture["executionResult"])

    case_evaluation_obj = CaseEvaluation.model_validate(fixture["caseEvaluation"])
    evaluation_obj = EvaluationResult.model_validate(fixture["evaluationResult"])
    versioned_evaluation_obj = VersionedEvaluationResult.model_validate(
        fixture["versionedEvaluationResult"]
    )
    evaluator_obj = EvaluatorDefinition.model_validate(fixture["evaluatorDefinition"])

    manifest_obj = PartitionManifest.model_validate(fixture["partitionManifest"])
    options_obj = PartitionOptions.model_validate(fixture["partitionOptions"])

    assert _dump_alias(round_obj) == fixture["round"]
    assert _dump_alias(progress_obj) == fixture["roundProgressEvent"]
    assert _dump_alias(checkpoint_obj) == fixture["roundCheckpoint"]
    assert _dump_alias(partition_case_obj) == fixture["partitionCase"]
    assert _dump_alias(case_obj) == fixture["caseRecord"]
    assert _dump_alias(evidence_trace_obj) == fixture["evidenceTrace"]
    assert _dump_alias(evidence_execution_obj) == fixture["evidenceExecution"]
    assert _dump_alias(evidence_missing_data_obj) == fixture["evidenceMissingData"]
    assert _dump_alias(finding_obj) == fixture["finding"]
    assert _dump_alias(hypothesis_obj) == fixture["hypothesis"]
    assert _dump_alias(snapshot_obj) == fixture["harnessSnapshot"]
    assert _dump_alias(candidate_change_obj) == fixture["candidateChange"]
    assert _dump_alias(candidate_obj) == fixture["candidate"]
    assert _dump_alias(execution_metrics_obj) == fixture["executionMetrics"]
    assert _dump_alias(execution_result_obj) == fixture["executionResult"]
    assert _dump_alias(case_evaluation_obj) == fixture["caseEvaluation"]
    assert _dump_alias(evaluation_obj) == fixture["evaluationResult"]
    assert _dump_alias(versioned_evaluation_obj) == fixture["versionedEvaluationResult"]
    assert _dump_alias(evaluator_obj) == fixture["evaluatorDefinition"]
    assert _dump_alias(manifest_obj) == fixture["partitionManifest"]
    assert _dump_alias(options_obj) == fixture["partitionOptions"]


def test_models_are_frozen() -> None:
    round_obj = Round(
        id="round-1",
        agent_id="agent-1",
        domain_id="domain-1",
        state="setup",
        objective="obj",
        created_at="2026-11-05T00:00:00.000Z",
        updated_at="2026-11-05T00:00:00.000Z",
    )

    with pytest.raises(Exception):
        round_obj.state = "collecting"


def test_opaque_payload_is_preserved_without_normalization_loss() -> None:
    snapshot = HarnessSnapshot.model_validate(
        {
            "id": "snapshot-opaque",
            "agentId": "agent-1",
            "domainId": "domain-1",
            "version": "v1",
            "components": {"planner": "prompt-v1"},
            "immutableConstraints": ["no-pii"],
            "createdAt": "2026-11-05T00:00:00.000Z",
            "opaquePayload": {
                "nested": {"alpha": [1, 2, 3], "beta": {"x": True}},
                "text": "opaque",
            },
        }
    )

    dumped = snapshot.model_dump(by_alias=True)
    assert dumped["opaquePayload"] == {
        "nested": {"alpha": [1, 2, 3], "beta": {"x": True}},
        "text": "opaque",
    }


def test_optional_omit_and_roundtrip_for_harness_snapshot_case_and_partition() -> None:
    snapshot = HarnessSnapshot.model_validate(
        {
            "id": "snapshot-1",
            "agentId": "agent-1",
            "domainId": "domain-1",
            "version": "v1",
            "components": {"planner": "prompt-v1"},
            "immutableConstraints": ["no-pii"],
            "createdAt": "2026-11-05T00:00:00.000Z",
        }
    )

    snapshot_dump = snapshot.model_dump(by_alias=True)
    assert "sourceVersion" not in snapshot_dump
    assert "artifactHash" not in snapshot_dump
    assert "opaquePayload" not in snapshot_dump

    snapshot_with_optional = HarnessSnapshot.model_validate(
        {
            "id": "snapshot-2",
            "agentId": "agent-1",
            "domainId": "domain-1",
            "version": "v2",
            "components": {"planner": "prompt-v2"},
            "immutableConstraints": ["no-pii"],
            "createdAt": "2026-11-05T00:00:00.000Z",
            "sourceVersion": "src-v2",
            "artifactHash": "sha256:abc",
            "opaquePayload": {"k": "v"},
        }
    )

    assert snapshot_with_optional.model_dump(by_alias=True)["sourceVersion"] == "src-v2"
    assert snapshot_with_optional.model_dump(by_alias=True)["artifactHash"] == "sha256:abc"
    assert snapshot_with_optional.model_dump(by_alias=True)["opaquePayload"] == {"k": "v"}

    case_record = CaseRecord.model_validate(
        {
            "id": "case-1",
            "agentId": "agent-1",
            "domainId": "domain-1",
            "sessionId": "session-1",
            "similarityGroup": "group-1",
            "content": "texto",
            "source": "manual",
            "createdAt": "2026-11-05T00:00:00.000Z",
        }
    )
    case_dump = case_record.model_dump(by_alias=True)
    assert "sourceReference" not in case_dump
    assert "syntheticLabel" not in case_dump

    options = PartitionOptions.model_validate(
        {
            "seed": "seed-1",
            "minimumReserved": 1,
            "reservedRatio": 0.1,
        }
    )
    options_dump = options.model_dump(by_alias=True)
    assert "createdAt" not in options_dump


@pytest.mark.parametrize(
    ("payload", "model"),
    [
        pytest.param(
            {
                "id": "snapshot-null",
                "agentId": "agent-1",
                "domainId": "domain-1",
                "version": "v1",
                "components": {"planner": "prompt-v1"},
                "immutableConstraints": ["no-pii"],
                "createdAt": "2026-11-05T00:00:00.000Z",
                "sourceVersion": None,
            },
            HarnessSnapshot,
            id="harness-source-version-null-explicito-rejeitado",
        ),
        pytest.param(
            {
                "id": "snapshot-null",
                "agentId": "agent-1",
                "domainId": "domain-1",
                "version": "v1",
                "components": {"planner": "prompt-v1"},
                "immutableConstraints": ["no-pii"],
                "createdAt": "2026-11-05T00:00:00.000Z",
                "artifactHash": None,
            },
            HarnessSnapshot,
            id="harness-artifact-hash-null-explicito-rejeitado",
        ),
        pytest.param(
            {
                "id": "snapshot-null",
                "agentId": "agent-1",
                "domainId": "domain-1",
                "version": "v1",
                "components": {"planner": "prompt-v1"},
                "immutableConstraints": ["no-pii"],
                "createdAt": "2026-11-05T00:00:00.000Z",
                "opaquePayload": None,
            },
            HarnessSnapshot,
            id="harness-opaque-payload-null-explicito-rejeitado",
        ),
        pytest.param(
            {
                "id": "case-1",
                "agentId": "agent-1",
                "domainId": "domain-1",
                "sessionId": "session-1",
                "similarityGroup": "group-1",
                "content": "texto",
                "source": "manual",
                "sourceReference": None,
                "createdAt": "2026-11-05T00:00:00.000Z",
            },
            CaseRecord,
            id="case-source-reference-null-explicito-rejeitado",
        ),
        pytest.param(
            {
                "id": "case-1",
                "agentId": "agent-1",
                "domainId": "domain-1",
                "sessionId": "session-1",
                "similarityGroup": "group-1",
                "content": "texto",
                "source": "manual",
                "syntheticLabel": None,
                "createdAt": "2026-11-05T00:00:00.000Z",
            },
            CaseRecord,
            id="case-synthetic-label-null-explicito-rejeitado",
        ),
        pytest.param(
            {
                "seed": "seed-1",
                "minimumReserved": 1,
                "reservedRatio": 0.1,
                "createdAt": None,
            },
            PartitionOptions,
            id="partition-created-at-null-explicito-rejeitado",
        ),
    ],
)
def test_optional_fields_reject_explicit_null_but_accept_omission(
    payload: dict[str, object],
    model: type[object],
) -> None:
    with pytest.raises(Exception):
        model.model_validate(payload)


def test_required_nullable_fields_keep_null_values() -> None:
    metrics = ExecutionMetrics.model_validate(
        {
            "inputTokens": None,
            "outputTokens": None,
            "cost": None,
            "latencyMs": 1,
        }
    )
    assert metrics.model_dump(by_alias=True)["inputTokens"] is None
    assert metrics.model_dump(by_alias=True)["outputTokens"] is None
    assert metrics.model_dump(by_alias=True)["cost"] is None

    trace = EvidenceTrace.model_validate(
        {
            "kind": "trace",
            "id": "evidence-1",
            "roundId": "round-1",
            "caseId": "case-1",
            "traceId": "trace-1",
            "observationId": None,
            "excerpt": "excerpt",
            "sourceUrl": None,
        }
    )
    trace_dump = trace.model_dump(by_alias=True)
    assert trace_dump["observationId"] is None
    assert trace_dump["sourceUrl"] is None

    case_evaluation = CaseEvaluation.model_validate(
        {
            "caseId": "case-1",
            "baselineExecutionId": "exec-1",
            "candidateExecutionId": "exec-2",
            "passed": True,
            "regression": False,
            "scoreChange": None,
            "criticalViolations": [],
        }
    )
    assert case_evaluation.model_dump(by_alias=True)["scoreChange"] is None

    execution_result = ExecutionResult.model_validate(
        {
            "id": "execution-1",
            "roundId": "round-1",
            "caseId": "case-1",
            "harnessSnapshotId": "snapshot-1",
            "status": "succeeded",
            "correlationId": "corr-1",
            "traceId": None,
            "output": None,
            "metrics": metrics.model_dump(by_alias=True),
            "limitations": [],
        }
    )
    execution_dump = execution_result.model_dump(by_alias=True)
    assert execution_dump["traceId"] is None
    assert execution_dump["output"] is None

    evaluation_result = EvaluationResult.model_validate(
        {
            "id": "evaluation-1",
            "roundId": "round-1",
            "candidateId": "candidate-1",
            "decision": "recommended",
            "sampleSize": 1,
            "confidence": 0.7,
            "aggregateScoreChange": None,
            "costChange": None,
            "latencyChange": None,
            "cases": [case_evaluation.model_dump(by_alias=True)],
            "limitations": [],
            "rationale": "ok",
        }
    )
    evaluation_dump = evaluation_result.model_dump(by_alias=True)
    assert evaluation_dump["aggregateScoreChange"] is None
    assert evaluation_dump["costChange"] is None
    assert evaluation_dump["latencyChange"] is None


def test_hypothesis_requires_evidence_ids_but_accepts_explicit_empty_list() -> None:
    with pytest.raises(Exception):
        Hypothesis.model_validate(
            {
                "id": "hypothesis-1",
                "findingId": "finding-1",
                "explanation": "exp",
                "expectedEffect": "effect",
            }
        )

    hypothesis = Hypothesis.model_validate(
        {
            "id": "hypothesis-1",
            "findingId": "finding-1",
            "explanation": "exp",
            "evidenceIds": [],
            "expectedEffect": "effect",
        }
    )
    assert _normalize(hypothesis.model_dump(by_alias=True)["evidenceIds"]) == []
