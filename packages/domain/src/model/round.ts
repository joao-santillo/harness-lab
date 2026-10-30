export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type RoundId = Brand<string, "RoundId">;
export type AgentId = Brand<string, "AgentId">;
export type DomainId = Brand<string, "DomainId">;
export type CaseId = Brand<string, "CaseId">;
export type EventId = Brand<string, "EventId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type SecretId = Brand<string, "SecretId">;
export type ExportId = Brand<string, "ExportId">;

export type TerminalDecision =
  | "recommended"
  | "rejected"
  | "inconclusive"
  | "pending_validation"
  | "validation_insufficient"
  | "stopped_by_limit"
  | "cancelled"
  | "integration_failed";

export type ActiveRoundState =
  | "setup"
  | "collecting"
  | "diagnosing"
  | "refining"
  | "executing"
  | "evaluating"
  | "exporting";

export type RoundState = ActiveRoundState | TerminalDecision;

export type RoundEvent =
  | "collection_started"
  | "diagnosis_started"
  | "refinement_started"
  | "execution_started"
  | "evaluation_started"
  | "export_started"
  | "recommendation_completed"
  | "rejection_completed"
  | "evaluation_inconclusive"
  | "validation_pending"
  | "validation_insufficient"
  | "limit_reached"
  | "cancel_requested"
  | "integration_failed";

type TransitionTable = {
  readonly [State in RoundState]: Readonly<Partial<Record<RoundEvent, RoundState>>>;
};

export const ROUND_TRANSITIONS: TransitionTable = {
  setup: {
    collection_started: "collecting",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  collecting: {
    diagnosis_started: "diagnosing",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  diagnosing: {
    refinement_started: "refining",
    validation_insufficient: "validation_insufficient",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  refining: {
    execution_started: "executing",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  executing: {
    evaluation_started: "evaluating",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  evaluating: {
    export_started: "exporting",
    recommendation_completed: "recommended",
    rejection_completed: "rejected",
    evaluation_inconclusive: "inconclusive",
    validation_pending: "pending_validation",
    validation_insufficient: "validation_insufficient",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  exporting: {
    recommendation_completed: "recommended",
    rejection_completed: "rejected",
    evaluation_inconclusive: "inconclusive",
    validation_pending: "pending_validation",
    validation_insufficient: "validation_insufficient",
    cancel_requested: "cancelled",
    integration_failed: "integration_failed",
    limit_reached: "stopped_by_limit",
  },
  recommended: {},
  rejected: {},
  inconclusive: {},
  pending_validation: {},
  validation_insufficient: {},
  stopped_by_limit: {},
  cancelled: {},
  integration_failed: {},
};

export function transitionRound(state: RoundState, event: RoundEvent): RoundState {
  const nextState = ROUND_TRANSITIONS[state][event];

  if (nextState === undefined) {
    throw new Error(`Invalid round transition: ${state} -> ${event}`);
  }

  return nextState;
}

export interface Round {
  readonly id: RoundId;
  readonly agentId: AgentId;
  readonly domainId: DomainId;
  readonly state: RoundState;
  readonly objective: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function applyRoundEvent(round: Round, event: RoundEvent, occurredAt: string): Round {
  return {
    ...round,
    state: transitionRound(round.state, event),
    updatedAt: occurredAt,
  };
}

export interface RoundProgressEvent {
  readonly id: EventId;
  readonly roundId: RoundId;
  readonly sequence: number;
  readonly event: RoundEvent;
  readonly state: RoundState;
  readonly occurredAt: string;
  readonly messageCode: string;
}

export interface RoundCheckpoint {
  readonly id: CheckpointId;
  readonly roundId: RoundId;
  readonly state: RoundState;
  readonly sequence: number;
  readonly createdAt: string;
}
