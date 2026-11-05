from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping, Sequence

from ..security.redactor import create_redactor
from .write_artifact import write_artifact

_SUMMARIES = {
    "pt-BR": "Relatório de avaliação auditável",
    "en": "Auditable evaluation report",
    "es": "Informe de evaluación auditable",
}


def export_report(
    *,
    data_dir: str,
    agent_id: str,
    round_id: str,
    locale: str,
    decision: str,
    confidence: float,
    sample_size: int,
    constraints: Sequence[str],
    regressions: Sequence[str],
    costs: Mapping[str, float],
    limitations: Sequence[str],
    evidence_chain: Sequence[Mapping[str, str]],
    source_versions: Mapping[str, str],
    secret_values: Sequence[str],
) -> dict[str, str]:
    redact = create_redactor(list(secret_values))
    report = redact(
        {
            "locale": locale,
            "summary": _SUMMARIES[locale],
            "decision": decision,
            "confidence": confidence,
            "sampleSize": sample_size,
            "constraints": list(constraints),
            "regressions": list(regressions),
            "costs": dict(costs),
            "limitations": list(limitations),
            "evidenceChain": [dict(item) for item in evidence_chain],
            "sourceVersions": dict(source_versions),
        }
    )
    directory = str(Path(data_dir) / "exports" / agent_id / round_id)
    return write_artifact(
        directory,
        f"report.{locale}.json",
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n",
        "application/json",
    )
