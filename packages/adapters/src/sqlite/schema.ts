import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const payloadColumns = {
  payloadVersion: integer("payload_version").notNull().default(1),
  payloadJson: text("payload_json").notNull(),
};

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  domainId: text("domain_id").notNull(),
  createdAt: text("created_at").notNull(),
  ...payloadColumns,
});

export const capabilities = sqliteTable("capabilities", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  domainId: text("domain_id").notNull(),
  createdAt: text("created_at").notNull(),
  ...payloadColumns,
});

export const harnessVersions = sqliteTable(
  "harness_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    domainId: text("domain_id").notNull(),
    version: text("version").notNull(),
    createdAt: text("created_at").notNull(),
    ...payloadColumns,
  },
  (table) => [uniqueIndex("harness_versions_agent_version").on(table.agentId, table.version)],
);

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  domainId: text("domain_id").notNull(),
  state: text("state").notNull(),
  objective: text("objective").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...payloadColumns,
});

export const roundEvents = sqliteTable(
  "round_events",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    occurredAt: text("occurred_at").notNull(),
    ...payloadColumns,
  },
  (table) => [uniqueIndex("round_events_round_sequence").on(table.roundId, table.sequence)],
);

export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    createdAt: text("created_at").notNull(),
    ...payloadColumns,
  },
  (table) => [uniqueIndex("checkpoints_round_sequence").on(table.roundId, table.sequence)],
);

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  domainId: text("domain_id").notNull(),
  createdAt: text("created_at").notNull(),
  ...payloadColumns,
});

export const casePartitions = sqliteTable("case_partitions", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  domainId: text("domain_id").notNull(),
  createdAt: text("created_at").notNull(),
  ...payloadColumns,
});

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => rounds.id),
    caseId: text("case_id").notNull().references(() => cases.id),
    agentId: text("agent_id").notNull().references(() => agents.id),
    domainId: text("domain_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
    ...payloadColumns,
  },
  (table) => [uniqueIndex("executions_idempotency_key").on(table.idempotencyKey)],
);

const scopedRoundTable = (name: string) =>
  sqliteTable(name, {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => rounds.id),
    agentId: text("agent_id").notNull().references(() => agents.id),
    domainId: text("domain_id").notNull(),
    createdAt: text("created_at").notNull(),
    ...payloadColumns,
  });

export const findings = scopedRoundTable("findings");
export const proposals = scopedRoundTable("proposals");
export const evaluations = scopedRoundTable("evaluations");
export const learnings = scopedRoundTable("learnings");
export const exportsTable = scopedRoundTable("exports");
