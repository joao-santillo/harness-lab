from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from harness2 import substrate as upstream_substrate
from harness2.core import tree as harness_tree
from harness2.core.tree import SurfaceSpec


@dataclass
class EditableSurfaceSubstrate:
    """Minimal substrate adapter exposing only editable surface requirements."""

    base_harness: Path
    component_names: tuple[str, ...]
    name: str = "local"

    def __post_init__(self) -> None:
        del self.component_names
        self.base_harness.mkdir(parents=True, exist_ok=True)
        if not harness_tree.is_tree(self.surface(), self.base_harness):
            base_tree = {
                "AGENTS.md": "# Harness Lab Base\n\n- Deterministic local harness for upstream contract tests.\n",
            }
            harness_tree.write_tree(self.surface(), base_tree, self.base_harness, stubs=True)

    def surface(self) -> SurfaceSpec:
        return upstream_substrate.CODEX_SURFACE
