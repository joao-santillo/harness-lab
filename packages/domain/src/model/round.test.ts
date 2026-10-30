import { describe, expect, it } from "vitest";
import {
  applyRoundEvent,
  transitionRound,
  type ActiveRoundState,
  type Round,
  type RoundEvent,
  type RoundState,
  type TerminalDecision,
} from "./round.js";

const activePath: ReadonlyArray<readonly [RoundEvent, ActiveRoundState]> = [
  ["collection_started", "collecting"],
  ["diagnosis_started", "diagnosing"],
  ["refinement_started", "refining"],
  ["execution_started", "executing"],
  ["evaluation_started", "evaluating"],
];

const activeStates: readonly ActiveRoundState[] = [
  "setup",
  "collecting",
  "diagnosing",
  "refining",
  "executing",
  "evaluating",
  "exporting",
];

const terminalTransitions: ReadonlyArray<
  readonly [RoundState, RoundEvent, TerminalDecision]
> = [
  ["evaluating", "recommendation_completed", "recommended"],
  ["evaluating", "rejection_completed", "rejected"],
  ["evaluating", "evaluation_inconclusive", "inconclusive"],
  ["evaluating", "validation_pending", "pending_validation"],
  ["evaluating", "validation_insufficient", "validation_insufficient"],
  ["exporting", "recommendation_completed", "recommended"],
  ["exporting", "rejection_completed", "rejected"],
  ["exporting", "evaluation_inconclusive", "inconclusive"],
  ["exporting", "validation_pending", "pending_validation"],
  ["exporting", "validation_insufficient", "validation_insufficient"],
  ["diagnosing", "validation_insufficient", "validation_insufficient"],
  ["setup", "limit_reached", "stopped_by_limit"],
  ["setup", "cancel_requested", "cancelled"],
  ["setup", "integration_failed", "integration_failed"],
];

const terminalStates: readonly TerminalDecision[] = [
  "recommended",
  "rejected",
  "inconclusive",
  "pending_validation",
  "validation_insufficient",
  "stopped_by_limit",
  "cancelled",
  "integration_failed",
];

describe("transitionRound", () => {
  it("follows the active lifecycle through evaluation", () => {
    let state: RoundState = "setup";

    for (const [event, expectedState] of activePath) {
      state = transitionRound(state, event);
      expect(state).toBe(expectedState);
    }
  });

  it("supports the optional export path to recommendation", () => {
    expect(transitionRound("evaluating", "export_started")).toBe("exporting");
    expect(transitionRound("exporting", "recommendation_completed")).toBe("recommended");
  });

  it.each(terminalTransitions)("allows %s -> %s -> %s", (state, event, terminalState) => {
    expect(transitionRound(state, event)).toBe(terminalState);
  });

  it.each(activeStates)("allows cancellation from active state %s", (state) => {
    expect(transitionRound(state, "cancel_requested")).toBe("cancelled");
  });

  it.each(activeStates)(
    "allows integration failure and limit stop from active state %s",
    (state) => {
      expect(transitionRound(state, "integration_failed")).toBe("integration_failed");
      expect(transitionRound(state, "limit_reached")).toBe("stopped_by_limit");
    },
  );

  it.each(terminalStates)("rejects events after terminal state %s", (state) => {
    expect(() => transitionRound(state, "cancel_requested")).toThrow("Invalid round transition");
  });

  it("rejects evaluation before collection", () => {
    expect(() => transitionRound("setup", "evaluation_started")).toThrow("Invalid round transition");
  });
});

describe("applyRoundEvent", () => {
  it("returns a new round without modifying the original", () => {
    const original: Round = {
      id: "round-1" as Round["id"],
      agentId: "agent-1" as Round["agentId"],
      domainId: "domain-1" as Round["domainId"],
      state: "setup",
      objective: "Evaluate refinement",
      createdAt: "2026-10-30T10:00:00.000Z",
      updatedAt: "2026-10-30T10:00:00.000Z",
    };

    const updated = applyRoundEvent(
      original,
      "collection_started",
      "2026-10-30T10:01:00.000Z",
    );

    expect(updated).not.toBe(original);
    expect(updated).toEqual({
      ...original,
      state: "collecting",
      updatedAt: "2026-10-30T10:01:00.000Z",
    });
    expect(original).toEqual({
      id: "round-1",
      agentId: "agent-1",
      domainId: "domain-1",
      state: "setup",
      objective: "Evaluate refinement",
      createdAt: "2026-10-30T10:00:00.000Z",
      updatedAt: "2026-10-30T10:00:00.000Z",
    });
  });
});
