from __future__ import annotations

from typing import Literal, NewType, TypeAlias

from . import DomainModel

Brand: TypeAlias = str
RoundId = NewType("RoundId", Brand)
AgentId = NewType("AgentId", Brand)
DomainId = NewType("DomainId", Brand)
CaseId = NewType("CaseId", Brand)
EventId = NewType("EventId", Brand)
CheckpointId = NewType("CheckpointId", Brand)
SecretId = NewType("SecretId", Brand)
ExportId = NewType("ExportId", Brand)

TerminalDecision = Literal[
    "recommended",
    "rejected",
    "inconclusive",
    "pending_validation",
    "validation_insufficient",
    "stopped_by_limit",
    "cancelled",
    "integration_failed",
]

ActiveRoundState = Literal[
    "setup",
    "collecting",
    "diagnosing",
    "refining",
    "executing",
    "evaluating",
    "exporting",
]

RoundState = ActiveRoundState | TerminalDecision

RoundEvent = Literal[
    "collection_started",
    "diagnosis_started",
    "refinement_started",
    "execution_started",
    "evaluation_started",
    "export_started",
    "recommendation_completed",
    "rejection_completed",
    "evaluation_inconclusive",
    "validation_pending",
    "validation_insufficient",
    "limit_reached",
    "cancel_requested",
    "integration_failed",
]

ROUND_TRANSITIONS: dict[RoundState, dict[RoundEvent, RoundState]] = {
    "setup": {
        "collection_started": "collecting",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "collecting": {
        "diagnosis_started": "diagnosing",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "diagnosing": {
        "refinement_started": "refining",
        "validation_insufficient": "validation_insufficient",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "refining": {
        "execution_started": "executing",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "executing": {
        "evaluation_started": "evaluating",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "evaluating": {
        "export_started": "exporting",
        "recommendation_completed": "recommended",
        "rejection_completed": "rejected",
        "evaluation_inconclusive": "inconclusive",
        "validation_pending": "pending_validation",
        "validation_insufficient": "validation_insufficient",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "exporting": {
        "recommendation_completed": "recommended",
        "rejection_completed": "rejected",
        "evaluation_inconclusive": "inconclusive",
        "validation_pending": "pending_validation",
        "validation_insufficient": "validation_insufficient",
        "cancel_requested": "cancelled",
        "integration_failed": "integration_failed",
        "limit_reached": "stopped_by_limit",
    },
    "recommended": {},
    "rejected": {},
    "inconclusive": {},
    "pending_validation": {},
    "validation_insufficient": {},
    "stopped_by_limit": {},
    "cancelled": {},
    "integration_failed": {},
}

ACTIVE_ROUND_STATES: tuple[ActiveRoundState, ...] = (
    "setup",
    "collecting",
    "diagnosing",
    "refining",
    "executing",
    "evaluating",
    "exporting",
)

TERMINAL_STATES: tuple[TerminalDecision, ...] = (
    "recommended",
    "rejected",
    "inconclusive",
    "pending_validation",
    "validation_insufficient",
    "stopped_by_limit",
    "cancelled",
    "integration_failed",
)


def transition_round(state: RoundState, event: RoundEvent) -> RoundState:
    next_state = ROUND_TRANSITIONS[state].get(event)
    if next_state is None:
        raise ValueError(f"Invalid round transition: {state} -> {event}")
    return next_state


class Round(DomainModel):
    id: RoundId
    agent_id: AgentId
    domain_id: DomainId
    state: RoundState
    objective: str
    created_at: str
    updated_at: str


class RoundProgressEvent(DomainModel):
    id: EventId
    round_id: RoundId
    sequence: int
    event: RoundEvent
    state: RoundState
    occurred_at: str
    message_code: str


class RoundCheckpoint(DomainModel):
    id: CheckpointId
    round_id: RoundId
    state: RoundState
    sequence: int
    created_at: str


def apply_round_event(round_obj: Round, event: RoundEvent, occurred_at: str) -> Round:
    return round_obj.model_copy(
        update={
            "state": transition_round(round_obj.state, event),
            "updated_at": occurred_at,
        }
    )
