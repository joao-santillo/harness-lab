from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec

from .substrate import EditableSurfaceSubstrate


@dataclass
class InMemoryBenchmarkAdapter:
    """Deterministic benchmark adapter used to contract-test upstream scheduler APIs."""

    benchmark_name: str
    substrate: EditableSurfaceSubstrate
    task_id: str
    domain: str
    prompt: str
    deliverable_text_value: str

    @property
    def spec(self) -> BenchSpec:
        return BenchSpec(
            name=self.benchmark_name,
            runs_root=Path("runs"),
            install_mode="codex_root",
            prompts=BenchPrompts(work="Deliver concise text output."),
            channels={
                "proposer": ChannelSpec(kind="claude_cli", model="claude-test"),
                "selector": ChannelSpec(kind="claude_cli", model="claude-test"),
            },
            allow_subagents=False,
        )

    def tasks(self, split: str = "all") -> list[str]:
        del split
        return [self.task_id]

    def domain_of(self, task_id: str) -> str:
        if task_id != self.task_id:
            raise KeyError(task_id)
        return self.domain

    def task_prompt(self, task_id: str) -> str:
        if task_id != self.task_id:
            raise KeyError(task_id)
        return self.prompt

    def task_files(self, task_id: str) -> Path | None:
        if task_id != self.task_id:
            raise KeyError(task_id)
        return None

    def execute(
        self, task_id: str, harness_dir: Path | None, run_id: str, *, timeout: int | None = None
    ) -> Path:
        del timeout
        if task_id != self.task_id:
            raise KeyError(task_id)

        run_dir = Path(harness_dir or self.substrate.base_harness.parent) / "executions" / self._slug(run_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "deliverable.txt").write_text(self.deliverable_text_value + "\n", encoding="utf-8")
        (run_dir / "trajectory.log").write_text(
            "[ACTION] deterministic execution\n[OBSERVATION] ok\n",
            encoding="utf-8",
        )
        return run_dir

    def delivered(self, run_dir: Path) -> bool:
        return (run_dir / "deliverable.txt").is_file()

    def trajectory(self, run_dir: Path, *, obs_trunc: int) -> str:
        content = (run_dir / "trajectory.log").read_text(encoding="utf-8")
        return content[:obs_trunc]

    def deliverable_files(self, run_dir: Path) -> dict[str, str]:
        return {"deliverable.txt": self.deliverable_text(run_dir)}

    def deliverable_text(self, run_dir: Path) -> str:
        return (run_dir / "deliverable.txt").read_text(encoding="utf-8").strip()

    def base_harness(self) -> Path:
        return self.substrate.base_harness

    def validate_tree(self, tree: dict[str, str]) -> None:
        if "AGENTS.md" not in tree:
            raise ValueError("AGENTS.md is required")

    def score(self, run_dir: Path, task_id: str) -> dict[str, object] | None:
        del run_dir, task_id
        return None

    @staticmethod
    def _slug(value: str) -> str:
        digest = hashlib.sha1(value.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
        clean = value.replace("/", "__")
        return f"{clean}-{digest}"
