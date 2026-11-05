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


def _normalize(value: object) -> object:
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_normalize(item) for item in value]
    return value


def _dump_alias(model: object) -> object:
    return _normalize(model.model_dump(by_alias=True))


def test_models_roundtrip_fixture_with_camel_case_aliases() -> None:
    fixture = _load_fixture()

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
