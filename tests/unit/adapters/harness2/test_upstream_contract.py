from __future__ import annotations

import json
from pathlib import Path

from harness2.core import library as library_store
from harness2.core import recursion, selection
from harness2.core import tree as harness_tree
from harness2.core.proposer import Proposer
from harness2.core.schedule import run_task
from harness2.core.spec import RunView

from harness_lab.adapters.harness2.benchmark import InMemoryBenchmarkAdapter
from harness_lab.adapters.harness2.substrate import EditableSurfaceSubstrate


def _patch_deterministic_mode(monkeypatch) -> None:
    def fake_run_mode(mode: str, *a, **kw):
        task_id = a[0]
        k = a[1]
        adapter = kw["adapter"]
        work_dir = kw["work_dir"]
        run_id_of = kw["run_id_of"]
        base_tree = kw["base_tree"]

        label = "agg1" if mode == "agg" else "c1"
        edited_tree = dict(base_tree)
        edited_tree["AGENTS.md"] = (
            edited_tree.get("AGENTS.md", "# Harness\n")
            + "\n- Candidate harness edited deterministically.\n"
        )

        harness_dir = Path(work_dir) / "harnesses" / label
        harness_tree.write_tree(adapter.substrate.surface(), edited_tree, harness_dir, stubs=True)

        run_id = run_id_of(label)
        run_dir = adapter.execute(task_id, harness_dir, run_id)
        rollout = RunView(
            label=label,
            run_id=run_id,
            run_dir=run_dir,
            ok=True,
            delivered=adapter.delivered(run_dir),
        )

        stage = recursion.Stage(label=label, dim="inv", tree=edited_tree, notes="deterministic stage")
        return recursion.ModeResult(
            mode=mode,
            task_id=task_id,
            k=k,
            stages=[stage],
            trees={label: edited_tree},
            rollouts={label: rollout},
            finals=[label],
        )

    def fake_reflect_adoption(task_id: str, sel, candidates, **kwargs):
        del task_id, candidates, kwargs
        sel.experience = {
            "cue": "deterministic-cue",
            "lesson": "deterministic-lesson",
            "evidence": "deterministic-evidence",
        }
        return dict(sel.experience)

    monkeypatch.setattr(recursion, "run_mode", fake_run_mode)
    monkeypatch.setattr(selection, "reflect_adoption", fake_reflect_adoption)


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

    prop = Proposer(adapter.spec.channels["proposer"], attempts=1)
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

    selection = result.selections["agg"]
    assert selection["ok"] is True
    assert selection["chosen_label"]

    chosen_run_id = selection["chosen_run_id"]
    assert chosen_run_id

    chosen_run_dir = Path(selection["chosen_run_dir"])
    assert chosen_run_dir.exists()
    assert adapter.delivered(chosen_run_dir)

    summary = runs_root / "harness-lab-local-agg1" / "task-001" / "summary.json"
    assert summary.exists()

    summary_payload = json.loads(summary.read_text(encoding="utf-8"))
    assert summary_payload["status"] == "ok"
    assert summary_payload["selections"]["agg"]["chosen_label"] == "agg1"

    entries = lib.entries()
    assert entries == ["task-001"]

    return _normalize_result(result)


def test_run_task_contract_upstream_parallel_k1(tmp_path: Path, monkeypatch) -> None:
    _patch_deterministic_mode(monkeypatch)

    first = _run_once(tmp_path / "case-1", tmp_path / "runs-1")
    second = _run_once(tmp_path / "case-2", tmp_path / "runs-2")

    assert first == second
