import type { AgentId, CaseRecord, DomainId } from "@harness-lab/domain";
import { describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./client.js";
import { SqliteCaseRepository } from "./case-repository.js";

describe("SqliteCaseRepository", () => {
  it("imports and lists bounded cases within their agent/domain scope", async () => {
    const database = await openSqliteDatabase(":memory:");
    const agentId = "agent-cases" as AgentId;
    const domainId = "domain-cases" as DomainId;
    await database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(agentId, domainId, "Case agent", "2026-11-03T10:00:00.000Z");
    const cases: CaseRecord[] = [
      { id: "case-a" as never, agentId, domainId, sessionId: "session-a", similarityGroup: "group-a", content: "Question A", source: "manual", createdAt: "2026-11-03T10:00:00.000Z" },
      { id: "case-b" as never, agentId, domainId, sessionId: "session-b", similarityGroup: "group-b", content: "Question B", source: "json", createdAt: "2026-11-03T10:00:00.000Z" },
    ];
    const repository = new SqliteCaseRepository(database);

    await expect(repository.saveMany(cases)).resolves.toBe(2);
    await expect(repository.listByScope(agentId, domainId)).resolves.toEqual(cases);
    await expect(repository.listByScope(agentId, "other-domain" as DomainId)).resolves.toEqual([]);
    await database.close();
  });

  it("rolls back a whole import batch if an ID already exists", async () => {
    const database = await openSqliteDatabase(":memory:");
    const agentId = "agent-atomic" as AgentId;
    const domainId = "domain-atomic" as DomainId;
    database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(agentId, domainId, "Case agent", "2026-11-03T10:00:00.000Z");
    const repository = new SqliteCaseRepository(database);
    const record = (id: string): CaseRecord => ({
      id: id as never, agentId, domainId, sessionId: id, similarityGroup: id,
      content: `Question ${id}`, source: "manual", createdAt: "2026-11-03T10:00:00.000Z",
    });
    await repository.saveMany([record("duplicate")]);

    await expect(repository.saveMany([record("new-case"), record("duplicate")])).rejects.toThrow("CASE_ALREADY_EXISTS");
    await expect(repository.listByScope(agentId, domainId)).resolves.toEqual([record("duplicate")]);
    await database.close();
  });

  it("inserts new cases and skips existing IDs without changing saveMany semantics", async () => {
    const database = await openSqliteDatabase(":memory:");
    const agentId = "agent-idempotent" as AgentId;
    const domainId = "domain-idempotent" as DomainId;
    database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(agentId, domainId, "Case agent", "2026-11-03T10:00:00.000Z");
    const repository = new SqliteCaseRepository(database);
    const record = (id: string, currentAgentId = agentId): CaseRecord => ({
      id: id as never, agentId: currentAgentId, domainId, sessionId: id, similarityGroup: id,
      content: `Question ${id}`, source: "historical", sourceReference: `langfuse:${id}`,
      createdAt: "2026-11-03T10:00:00.000Z",
    });
    await repository.saveMany([record("existing")]);

    await expect(repository.saveManyIgnoringExisting([record("existing"), record("new")])).resolves.toBe(1);
    await expect(repository.listByScope(agentId, domainId)).resolves.toHaveLength(2);

    await expect(repository.saveManyIgnoringExisting([record("newer", "missing-agent" as AgentId)]))
      .rejects.toThrow("CASE_SCOPE_INVALID");
    await expect(repository.listByScope(agentId, domainId)).resolves.toHaveLength(2);
    await database.close();
  });

  it("rejects duplicate IDs within an idempotent batch", async () => {
    const database = await openSqliteDatabase(":memory:");
    const agentId = "agent-batch-duplicate" as AgentId;
    const domainId = "domain-batch-duplicate" as DomainId;
    database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(agentId, domainId, "Case agent", "2026-11-03T10:00:00.000Z");
    const repository = new SqliteCaseRepository(database);
    const record: CaseRecord = {
      id: "same-id" as never, agentId, domainId, sessionId: "same", similarityGroup: "same",
      content: "Question", source: "historical", sourceReference: "langfuse:same",
      createdAt: "2026-11-03T10:00:00.000Z",
    };

    await expect(repository.saveManyIgnoringExisting([record, record])).rejects.toThrow("CASE_ID_DUPLICATE");
    await expect(repository.listByScope(agentId, domainId)).resolves.toEqual([]);
    await database.close();
  });
});