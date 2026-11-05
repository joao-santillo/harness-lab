from __future__ import annotations

import hashlib
import json
import stat
from pathlib import Path

import pytest

from harness_lab.adapters.export.candidate_exporter import export_candidate
from harness_lab.adapters.export.report_exporter import export_report


@pytest.mark.parametrize("locale", ("pt-BR", "en", "es"))
def test_report_export_localized_without_publish_capability(tmp_path: Path, locale: str) -> None:
    artifact = export_report(
        data_dir=str(tmp_path),
        agent_id="agent-1",
        round_id=f"round-{locale}",
        locale=locale,
        decision="inconclusive",
        confidence=0.55,
        sample_size=2,
        constraints=("No production publication",),
        regressions=(),
        costs={"baseline": 1.0, "candidate": 0.8},
        limitations=("Small sample",),
        evidence_chain=({"findingId": "finding-1", "hypothesisId": "hypothesis-1", "proposalId": "proposal-1"},),
        source_versions={"evaluator": "1.0.0"},
        secret_values=(),
    )

    report = json.loads(Path(artifact["path"]).read_text(encoding="utf-8"))
    assert report["locale"] == locale
    assert report["decision"] == "inconclusive"
    assert "publish" not in report
    assert "promote" not in report


def test_candidate_export_redacts_preserves_unknown_fields_and_hash_mode(tmp_path: Path) -> None:
    artifacts = export_candidate(
        data_dir=str(tmp_path),
        agent_id="agent-1",
        round_id="round-1",
        source_artifact={
            "version": "1",
            "components": {"prompt": "Use top-secret"},
            "extensionField": {"enabled": True},
            "apiKey": "top-secret",
        },
        changes=(
            {
                "component": "prompt",
                "before": "Old",
                "after": "Use top-secret",
                "expectedEffect": "Improve grounding",
            },
        ),
        source_versions={"agentPlatform": "42", "harness2": "abc"},
        secret_values=("top-secret",),
    )

    assert [artifact["media_type"] for artifact in artifacts] == [
        "application/json",
        "application/json",
        "text/plain",
    ]

    for artifact in artifacts:
        path = Path(artifact["path"])
        content = path.read_bytes()
        assert hashlib.sha256(content).hexdigest() == artifact["hash"]
        assert b"top-secret" not in content
        assert stat.S_IMODE(path.stat().st_mode) == 0o600

    candidate = json.loads(Path(artifacts[0]["path"]).read_text(encoding="utf-8"))
    assert candidate["extensionField"] == {"enabled": True}
    assert candidate["apiKey"] == "[REDACTED]"
    assert candidate["components"]["prompt"] == "Use [REDACTED]"
    assert candidate["_harnessLab"]["sourceVersions"] == {"agentPlatform": "42", "harness2": "abc"}


def test_atomic_overwrite_replaces_previous_bytes(tmp_path: Path) -> None:
    first = export_report(
        data_dir=str(tmp_path),
        agent_id="agent-1",
        round_id="round-atomic",
        locale="en",
        decision="recommended",
        confidence=0.99,
        sample_size=10,
        constraints=("Constraint A",),
        regressions=(),
        costs={"baseline": 3.2, "candidate": 2.1},
        limitations=(),
        evidence_chain=(),
        source_versions={"evaluator": "1.0.0"},
        secret_values=(),
    )
    second = export_report(
        data_dir=str(tmp_path),
        agent_id="agent-1",
        round_id="round-atomic",
        locale="en",
        decision="rejected",
        confidence=0.1,
        sample_size=1,
        constraints=("Constraint B",),
        regressions=("Regression",),
        costs={"baseline": 3.2, "candidate": 4.5},
        limitations=("Limited",),
        evidence_chain=(),
        source_versions={"evaluator": "1.0.1"},
        secret_values=(),
    )

    path = Path(first["path"])
    assert first["path"] == second["path"]
    report = json.loads(path.read_text(encoding="utf-8"))
    assert report["decision"] == "rejected"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == second["hash"]
