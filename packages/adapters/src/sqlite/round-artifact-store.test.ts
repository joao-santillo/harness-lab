import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, DomainId, HarnessSnapshotId, Round, RoundId } from "@harness-lab/domain";
import type { RoundArtifactSession } from "@harness-lab/application";
import { describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./client.js";
import { SqliteRoundArtifactStore } from "./round-artifact-store.js";

describe("SqliteRoundArtifactStore", () => {
  it("restores the latest complete stage session after reopening the database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "round-artifacts-"));
    const path = join(directory, "harness.sqlite");
    const round: Round = {
      id: "round-1" as RoundId, agentId: "agent-1" as AgentId, domainId: "domain-1" as DomainId,
      state: "collecting", objective: "Improve", createdAt: "2026-10-31T10:00:00.000Z", updatedAt: "2026-10-31T10:00:00.000Z",
    };
    const session: RoundArtifactSession = {
      cases: [{ id: "case-1", sessionId: "s1", similarityGroup: "g1", content: "question" }, { id: "case-2", sessionId: "s2", similarityGroup: "g2", content: "question" }],
      partition: { version: 1, seed: "seed", diagnosisIds: ["case-1"], reservedIds: ["case-2"], createdAt: round.createdAt },
      baseline: { id: "baseline-1" as HarnessSnapshotId, agentId: round.agentId, domainId: round.domainId, version: "1", components: {}, immutableConstraints: [], createdAt: round.createdAt },
      capabilities: { editableComponents: [], supportsSeed: false, supportsToolReplay: false },
      diagnosis: { evidence: [], findings: [], hypotheses: [], actionability: [] },
      refinement: { candidates: [], composed: null, rejected: [], lessons: [], stopReason: "completed" },
      reservedExecutions: [], evaluation: null,
    };

    const database = await openSqliteDatabase(path);
    database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)").run(round.agentId, round.domainId, "Agent", round.createdAt);
    database.prepare("INSERT INTO rounds (id, agent_id, domain_id, state, objective, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(round.id, round.agentId, round.domainId, round.state, round.objective, round.createdAt, round.updatedAt, JSON.stringify(round));
    await new SqliteRoundArtifactStore(database).save(round.id, session);
    await database.close();

    const reopened = await openSqliteDatabase(path);
    await expect(new SqliteRoundArtifactStore(reopened).get(round.id)).resolves.toEqual(session);
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });
});