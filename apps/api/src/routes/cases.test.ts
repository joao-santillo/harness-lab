import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

describe("agent and case routes", () => {
  it("creates an agent and imports/lists cases by scope without partial writes on duplicate", async () => {
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
    });
    const createdAgent = await server.inject({
      method: "POST",
      url: "/api/v1/agents",
      payload: { id: "agent-cases", domainId: "domain-cases", name: "Cases" },
    });
    expect(createdAgent.statusCode).toBe(201);

    const imported = await server.inject({
      method: "POST",
      url: "/api/v1/cases/import",
      payload: {
        agentId: "agent-cases", domainId: "domain-cases", source: "json",
        cases: [
          { id: "case-a", sessionId: "session-a", similarityGroup: "group-a", content: "Question A" },
          { id: "case-b", sessionId: "session-b", similarityGroup: "group-b", content: "Question B" },
        ],
      },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toEqual({ imported: 2 });
    const listed = await server.inject({ method: "GET", url: "/api/v1/cases?agentId=agent-cases&domainId=domain-cases" });
    expect(listed.json()).toMatchObject({ items: [
      { id: "case-a", source: "json", content: "Question A" },
      { id: "case-b", source: "json", content: "Question B" },
    ] });

    const duplicate = await server.inject({
      method: "POST",
      url: "/api/v1/cases/import",
      payload: {
        agentId: "agent-cases", domainId: "domain-cases", source: "manual",
        cases: [
          { id: "case-c", sessionId: "session-c", similarityGroup: "group-c", content: "Question C" },
          { id: "case-a", sessionId: "session-a", similarityGroup: "group-a", content: "Question A duplicate" },
        ],
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect((await server.inject({ method: "GET", url: "/api/v1/cases?agentId=agent-cases&domainId=domain-cases" })).json().items).toHaveLength(2);
    await server.close();
  });

  it("rejects imports outside the selected agent scope and oversized batches", async () => {
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
    });
    await server.inject({ method: "POST", url: "/api/v1/agents", payload: { id: "agent-scope", domainId: "domain-1", name: "Scoped" } });
    const outsideScope = await server.inject({
      method: "POST", url: "/api/v1/cases/import",
      payload: { agentId: "agent-scope", domainId: "other-domain", source: "manual", cases: [{ id: "case-x", sessionId: "s", similarityGroup: "g", content: "question" }] },
    });
    expect(outsideScope.statusCode).toBe(422);
    const missingScope = await server.inject({ method: "GET", url: "/api/v1/cases?agentId=agent-scope" });
    expect(missingScope.statusCode).toBe(400);
    const oversized = await server.inject({
      method: "POST",
      url: "/api/v1/cases/import",
      payload: {
        agentId: "agent-scope", domainId: "domain-1", source: "json",
        cases: Array.from({ length: 41 }, (_, index) => ({
          id: `case-${index}`, sessionId: `session-${index}`, similarityGroup: `group-${index}`, content: `Question ${index}`,
        })),
      },
    });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json()).toEqual({ code: "CASE_IMPORT_INVALID" });
    await server.close();
  });

  it("imports RFC4180 CSV cases and records CSV provenance server-side", async () => {
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
    });
    await server.inject({ method: "POST", url: "/api/v1/agents", payload: { id: "csv-agent", domainId: "csv-domain", name: "CSV" } });
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/cases/import-csv",
      payload: {
        agentId: "csv-agent", domainId: "csv-domain",
        csv: 'id,sessionId,similarityGroup,content\r\ncase-csv,s-1,g-1,"Question, with comma"',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ imported: 1 });
    expect((await server.inject({ method: "GET", url: "/api/v1/cases?agentId=csv-agent&domainId=csv-domain" })).json().items)
      .toMatchObject([{ id: "case-csv", source: "csv", content: "Question, with comma" }]);
    await server.close();
  });

  it("requires explicit provenance for historical and synthetic JSON cases", async () => {
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
    });
    await server.inject({ method: "POST", url: "/api/v1/agents", payload: { id: "source-agent", domainId: "source-domain", name: "Source" } });
    const baseCase = { id: "case-source", sessionId: "session", similarityGroup: "group", content: "Question" };
    const unreferencedHistorical = await server.inject({
      method: "POST", url: "/api/v1/cases/import",
      payload: { agentId: "source-agent", domainId: "source-domain", source: "historical", cases: [baseCase] },
    });
    expect(unreferencedHistorical.statusCode).toBe(400);

    const historical = await server.inject({
      method: "POST", url: "/api/v1/cases/import",
      payload: {
        agentId: "source-agent", domainId: "source-domain", source: "historical",
        sourceReference: "langfuse-project:trace-export-2026-11", cases: [{ ...baseCase, id: "historical-case" }],
      },
    });
    expect(historical.statusCode).toBe(201);

    const unlabeledSynthetic = await server.inject({
      method: "POST", url: "/api/v1/cases/import",
      payload: { agentId: "source-agent", domainId: "source-domain", source: "synthetic", cases: [baseCase] },
    });
    expect(unlabeledSynthetic.statusCode).toBe(400);

    const labeledSynthetic = await server.inject({
      method: "POST", url: "/api/v1/cases/import",
      payload: { agentId: "source-agent", domainId: "source-domain", source: "synthetic", cases: [{ ...baseCase, syntheticLabel: "SYNTHETIC" }] },
    });
    expect(labeledSynthetic.statusCode).toBe(201);
    expect((await server.inject({ method: "GET", url: "/api/v1/cases?agentId=source-agent&domainId=source-domain" })).json().items)
      .toMatchObject([
        { id: "historical-case", source: "historical", sourceReference: "langfuse-project:trace-export-2026-11" },
        { source: "synthetic", syntheticLabel: "SYNTHETIC" },
      ]);
    await server.close();
  });
});