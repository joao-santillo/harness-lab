from __future__ import annotations

from typing import Literal, TypedDict

from harness_lab.domain import HarnessSnapshot

ProposalRejectionReason = Literal[
    "IMMUTABLE_CONSTRAINT",
    "UNSUPPORTED_COMPONENT",
    "COMPONENT_COLLISION",
]


class RefinementProposal(TypedDict):
    component: str
    after: str


def validate_proposal(
    baseline: HarnessSnapshot,
    proposal: RefinementProposal,
    supported_components: tuple[str, ...] | list[str],
) -> ProposalRejectionReason | None:
    if (
        proposal["component"] not in supported_components
        or baseline.components.get(proposal["component"]) is None
    ):
        return "UNSUPPORTED_COMPONENT"
    if any(
        constraint in proposal["after"]
        for constraint in baseline.immutable_constraints
    ):
        return "IMMUTABLE_CONSTRAINT"
    return None
