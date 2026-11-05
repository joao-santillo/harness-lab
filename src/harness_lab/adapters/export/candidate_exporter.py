from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from ..security.redactor import create_redactor
from .write_artifact import write_artifact


def export_candidate(
    *,
    data_dir: str,
    agent_id: str,
    round_id: str,
    source_artifact: Mapping[str, Any],
    changes: Sequence[Mapping[str, Any]],
    source_versions: Mapping[str, str],
    secret_values: Sequence[str],
) -> tuple[dict[str, str], ...]:
    redact = create_redactor(list(secret_values))
    directory = str(Path(data_dir) / "exports" / agent_id / round_id)

    candidate = redact(
        {
            **dict(source_artifact),
            "_harnessLab": {"sourceVersions": dict(source_versions), "roundId": round_id},
        }
    )
    technical_diff = redact({"changes": [dict(change) for change in changes], "sourceVersions": dict(source_versions)})
    plain_diff = "\n".join(
        f"{change.get('component', '')}: {change.get('expectedEffect', '')}" for change in changes
    )

    return (
        write_artifact(
            directory,
            "candidate.json",
            f"{json.dumps(candidate, ensure_ascii=False, indent=2)}\n",
            "application/json",
        ),
        write_artifact(
            directory,
            "diff.technical.json",
            f"{json.dumps(technical_diff, ensure_ascii=False, indent=2)}\n",
            "application/json",
        ),
        write_artifact(directory, "diff.txt", f"{str(redact(plain_diff))}\n", "text/plain"),
    )
