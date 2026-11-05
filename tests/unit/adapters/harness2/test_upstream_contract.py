from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from harness2.core import library as library_store
from harness2.core.proposer import Reply
from harness2.core.schedule import run_task
from harness2.core.spec import ChannelSpec

from harness_lab.adapters.harness2.benchmark import InMemoryBenchmarkAdapter
from harness_lab.adapters.harness2.substrate import EditableSurfaceSubstrate


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)


@dataclass
class DeterministicProposer:
    spec: ChannelSpec
    workspace_root: Path
    attempts: int = 1
    audit_dir: Path | None = None
    project: str = "local"
    region: str = "local"
    _calls: int = field(default=0, init=False)

    def call(
        self,
        mission: str,
        context_dir: Path | str | None,
        label: str,
        *,
        system: str = "",
        timeout: int | None = None,
        max_attempts: int | None = None,
        harvest: str | None = None,
    ) -> Reply:
        del mission, system, timeout, max_attempts
        self._calls += 1

        workspace = None
        if harvest:
            source = Path(context_dir) / harvest if context_dir else None
            if source is not None and not source.is_dir() and harvest.startswith("context/"):
                source = Path(context_dir) / harvest.removeprefix("context/")
            if source is not None and source.is_dir():
                workspace = self.workspace_root / f"{_safe(label)}-{self._calls}.workspace"
                shutil.rmtree(workspace, ignore_errors=True)
                shutil.copytree(source, workspace)
                agents = workspace / "AGENTS.md"
                body = agents.read_text(encoding="utf-8") if agents.exists() else "# Harness\n"
                body += f"\n- deterministic edit from {label}.\n"
                agents.write_text(body, encoding="utf-8")

        if label.startswith("experience."):
            text = (
                "<experience>\n"
                "cue: deterministic-cue\n"
                "lesson: deterministic-lesson\n"
                "evidence: deterministic-evidence\n"
                "confidence: high\n"
                "</experience>\n"
                "<edits>Updated AGENTS.md with deterministic stage markers.</edits>\n"
            )
        elif label.startswith("select."):
            text = "```choice\nA\n```\n<why>Deterministic single-candidate selection.</why>\n"
        else:
            text = f"<notes>deterministic stage {label}</notes>"

        return Reply(
            label=label,
            text=text,
            ok=True,
            cost_usd=0.0,
            wall_s=0.0,
            attempts=1,
            cached=False,
            channel=self.spec.kind,
            error="",
            audit=None,
            workspace=workspace,
        )


def _normalize_result(result) -> dict:
    payload = result.to_dict()
    for item in payload.get("base", []):
        item["run_dir"] = "<run-dir>"
    for mode_name, sel in payload.get("selections", {}).items():
        if isinstance(sel, dict):
            sel["chosen_run_dir"] = "<run-dir>"
            sel["harness_fingerprint"] = "<fingerprint>"
        payload["selections"][mode_name] = sel
    return payload


def _run_once(tmp_path: Path, runs_root: Path) -> dict:
    base_harness = tmp_path / "base-harness"
    base_harness.mkdir(parents=True, exist_ok=True)

    substrate = EditableSurfaceSubstrate(
        base_harness=base_harness,
        component_names=("c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"),
    )
    adapter = InMemoryBenchmarkAdapter(
        benchmark_name="harness-lab",
        substrate=substrate,
        task_id="task-001",
        domain="retail",
        prompt="Summarize trade-offs.",
        deliverable_text_value="final-answer",
    )

    prop = DeterministicProposer(
        adapter.spec.channels["proposer"],
        workspace_root=tmp_path / "proposer-workspaces",
        attempts=1,
    )
    lib = library_store.Library(root=tmp_path / "library", domain="retail", surface=substrate.surface())

    result = run_task(
        "task-001",
        1,
        adapter=adapter,
        prop=prop,
        runs_root=runs_root,
        modes=("agg",),
        libraries={"agg": lib},
    )

    assert result.status == "ok"
    assert result.domain == "retail"
    assert len(result.base) == 1

    mode = result.modes["agg"]
    assert mode["ok"] is True
    assert mode["finals"] == ["agg1"]
    assert [stage["label"] for stage in mode["stages"]] == ["inv1", "dom1", "agg1"]
    assert all(stage["fell_back"] is False for stage in mode["stages"])

    final_harness = runs_root / "harness-lab-local-agg1" / "task-001" / "harnesses" / "agg1" / "AGENTS.md"
    assert final_harness.exists()
    final_harness_body = final_harness.read_text(encoding="utf-8")
    assert "deterministic edit from agg1" in final_harness_body

    selected = result.selections["agg"]
    assert selected["ok"] is True
    assert selected["trivial"] is True
    assert selected["chosen_label"] == "agg1"
    assert selected["chosen_tree_is_base"] is False

    chosen_run_id = selected["chosen_run_id"]
    assert chosen_run_id

    chosen_run_dir = Path(selected["chosen_run_dir"])
    assert chosen_run_dir.exists()
    assert adapter.delivered(chosen_run_dir)
    assert adapter.deliverable_text(chosen_run_dir) == "final-answer"

    selection_json = runs_root / "harness-lab-local-agg1" / "task-001" / "selection" / "agg1" / "selection.json"
    assert selection_json.exists()
    selection_payload = json.loads(selection_json.read_text(encoding="utf-8"))
    assert selection_payload["chosen_label"] == "agg1"
    assert selection_payload["trivial"] is True

    summary = runs_root / "harness-lab-local-agg1" / "task-001" / "summary.json"
    assert summary.exists()

    summary_payload = json.loads(summary.read_text(encoding="utf-8"))
    assert summary_payload["status"] == "ok"
    assert summary_payload["selections"]["agg"]["chosen_label"] == "agg1"

    entries = lib.entries()
    assert entries == ["task-001"]
    entry = lib.entry_dir("task-001")
    exp = (entry / "EXPERIENCE.md").read_text(encoding="utf-8")
    assert "deterministic-lesson" in exp
    assert "deterministic-evidence" in exp
    stored_harness = (entry / "harness" / "AGENTS.md").read_text(encoding="utf-8")
    assert "deterministic edit from agg1" in stored_harness

    return _normalize_result(result)


def test_run_task_contract_upstream_parallel_k1(tmp_path: Path) -> None:
    first = _run_once(tmp_path / "case-1", tmp_path / "runs-1")
    second = _run_once(tmp_path / "case-2", tmp_path / "runs-2")

    assert first == second
