from __future__ import annotations

from harness_lab.application.refinement.change_policy import validate_proposal
from harness_lab.domain import HarnessSnapshot

BASELINE = HarnessSnapshot.model_validate(
    {
        "id": "baseline-1",
        "agentId": "agent-1",
        "domainId": "domain-1",
        "version": "1",
        "components": {
            "system-prompt": "Be useful.",
            "tool-guidance": "Search when needed.",
        },
        "immutableConstraints": ("Never disclose secrets.",),
        "createdAt": "2026-10-31T00:00:00.000Z",
    }
)


def test_change_policy_rejects_unsupported_component() -> None:
    reason = validate_proposal(
        BASELINE,
        {
            "component": "unknown",
            "after": "new value",
        },
        ("system-prompt", "tool-guidance"),
    )
    assert reason == "UNSUPPORTED_COMPONENT"


def test_change_policy_rejects_immutable_constraint_substring() -> None:
    reason = validate_proposal(
        BASELINE,
        {
            "component": "system-prompt",
            "after": "Do this. Never disclose secrets. And that.",
        },
        ("system-prompt", "tool-guidance"),
    )
    assert reason == "IMMUTABLE_CONSTRAINT"


def test_change_policy_accepts_supported_non_immutable_change() -> None:
    reason = validate_proposal(
        BASELINE,
        {
            "component": "tool-guidance",
            "after": "Search when needed and cite evidence.",
        },
        ("system-prompt", "tool-guidance"),
    )
    assert reason is None