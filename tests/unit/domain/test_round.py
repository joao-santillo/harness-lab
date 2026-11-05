from __future__ import annotations

import pytest

from harness_lab.domain.models.round import (
    ACTIVE_ROUND_STATES,
    TERMINAL_STATES,
    Round,
    RoundEvent,
    RoundState,
    apply_round_event,
    transition_round,
)

active_path: tuple[tuple[RoundEvent, str], ...] = (
    ("collection_started", "collecting"),
    ("diagnosis_started", "diagnosing"),
    ("refinement_started", "refining"),
    ("execution_started", "executing"),
    ("evaluation_started", "evaluating"),
)

terminal_transitions: tuple[tuple[RoundState, RoundEvent, str], ...] = (
    ("evaluating", "recommendation_completed", "recommended"),
    ("evaluating", "rejection_completed", "rejected"),
    ("evaluating", "evaluation_inconclusive", "inconclusive"),
    ("evaluating", "validation_pending", "pending_validation"),
    ("evaluating", "validation_insufficient", "validation_insufficient"),
    ("exporting", "recommendation_completed", "recommended"),
    ("exporting", "rejection_completed", "rejected"),
    ("exporting", "evaluation_inconclusive", "inconclusive"),
    ("exporting", "validation_pending", "pending_validation"),
    ("exporting", "validation_insufficient", "validation_insufficient"),
    ("diagnosing", "validation_insufficient", "validation_insufficient"),
    ("setup", "limit_reached", "stopped_by_limit"),
    ("setup", "cancel_requested", "cancelled"),
    ("setup", "integration_failed", "integration_failed"),
)


class TestTransitionRound:
    def test_follows_active_lifecycle_through_evaluation(self) -> None:
        state: RoundState = "setup"

        for event, expected_state in active_path:
            state = transition_round(state, event)
            assert state == expected_state

    def test_supports_optional_export_path_to_recommendation(self) -> None:
        assert transition_round("evaluating", "export_started") == "exporting"
        assert transition_round("exporting", "recommendation_completed") == "recommended"

    @pytest.mark.parametrize(("state", "event", "terminal_state"), terminal_transitions)
    def test_allows_terminal_transitions(
        self,
        state: RoundState,
        event: RoundEvent,
        terminal_state: str,
    ) -> None:
        assert transition_round(state, event) == terminal_state

    @pytest.mark.parametrize("state", ACTIVE_ROUND_STATES)
    def test_allows_cancellation_from_all_active_states(self, state: str) -> None:
        assert transition_round(state, "cancel_requested") == "cancelled"

    @pytest.mark.parametrize("state", ACTIVE_ROUND_STATES)
    def test_allows_integration_failure_and_limit_stop_from_all_active_states(self, state: str) -> None:
        assert transition_round(state, "integration_failed") == "integration_failed"
        assert transition_round(state, "limit_reached") == "stopped_by_limit"

    @pytest.mark.parametrize("state", TERMINAL_STATES)
    def test_rejects_events_after_terminal_state(self, state: str) -> None:
        with pytest.raises(ValueError, match=r"Invalid round transition"):
            transition_round(state, "cancel_requested")

    def test_rejects_evaluation_before_collection(self) -> None:
        with pytest.raises(ValueError, match=r"Invalid round transition: setup -> evaluation_started"):
            transition_round("setup", "evaluation_started")


class TestApplyRoundEvent:
    def test_returns_new_round_without_modifying_original(self) -> None:
        original = Round(
            id="round-1",
            agent_id="agent-1",
            domain_id="domain-1",
            state="setup",
            objective="Evaluate refinement",
            created_at="2026-10-30T10:00:00.000Z",
            updated_at="2026-10-30T10:00:00.000Z",
        )

        updated = apply_round_event(
            original,
            "collection_started",
            "2026-10-30T10:01:00.000Z",
        )

        assert updated is not original
        assert updated.model_dump() == {
            **original.model_dump(),
            "state": "collecting",
            "updated_at": "2026-10-30T10:01:00.000Z",
        }
        assert original.model_dump() == {
            "id": "round-1",
            "agent_id": "agent-1",
            "domain_id": "domain-1",
            "state": "setup",
            "objective": "Evaluate refinement",
            "created_at": "2026-10-30T10:00:00.000Z",
            "updated_at": "2026-10-30T10:00:00.000Z",
        }
