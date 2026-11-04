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

  it("imports Langfuse roots idempotently without returning remote output", async () => {
    const importFilters: string[] = [];
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
      fetch: async (input) => {
        const url = input as URL;
        if (url.pathname.endsWith("/observations")) {
          if (!url.searchParams.has("fromStartTime")) return Response.json({ data: [], meta: { cursor: null } });
          importFilters.push(url.searchParams.get("filter") ?? "");
          return Response.json({
            data: [{
              id: "root-observation",
              traceId: "trace-imported",
              isRootObservation: true,
              startTime: "2026-11-03T10:00:00.000Z",
              sessionId: "session-imported",
              traceName: "support-flow",
              input: { prompt: "customer question" },
              output: "must never be returned",
            }],
            meta: { cursor: null },
          });
        }
        return Response.json({ data: [], meta: { page: 1, totalPages: 1 } });
      },
    });
    await server.inject({ method: "POST", url: "/api/v1/agents", payload: { id: "langfuse-agent", domainId: "langfuse-domain", name: "Langfuse" } });
    await server.inject({ method: "POST", url: "/api/v1/agents", payload: { id: "langfuse-agent-other", domainId: "other-domain", name: "Other scope" } });
    await server.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers: { "idempotency-key": "langfuse-connection" },
      payload: {
        id: "langfuse-connection", kind: "langfuse", name: "Langfuse",
        credentials: { baseUrl: "https://langfuse.example", publicKey: "pk", secretKey: "sk" },
      },
    });

    const payload = {
      agentId: "langfuse-agent", domainId: "langfuse-domain", connectionId: "langfuse-connection",
      fromStartTime: "2026-11-03T00:00:00.000Z", toStartTime: "2026-11-04T00:00:00.000Z", limit: 20,
      filter: { field: "traceName", value: "support-flow" },
    };
    const imported = await server.inject({ method: "POST", url: "/api/v1/cases/import-langfuse", payload });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toEqual({
      imported: 1,
      skipped: 0,
      source: { connectionId: "langfuse-connection", fromStartTime: payload.fromStartTime, toStartTime: payload.toStartTime },
      limitations: [],
    });
    expect(imported.body).not.toContain("must never be returned");
    expect(importFilters).toEqual([JSON.stringify([
        { type: "datetime", column: "startTime", operator: ">=", value: payload.fromStartTime },
        { type: "datetime", column: "startTime", operator: "<", value: payload.toStartTime },
        { type: "string", column: "traceName", operator: "=", value: "support-flow" },
      ])]);

    const repeated = await server.inject({ method: "POST", url: "/api/v1/cases/import-langfuse", payload });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toMatchObject({ imported: 0, skipped: 1 });
    const otherScope = await server.inject({
      method: "POST", url: "/api/v1/cases/import-langfuse",
      payload: { ...payload, agentId: "langfuse-agent-other", domainId: "other-domain" },
    });
    expect(otherScope.statusCode).toBe(201);
    expect(otherScope.json()).toMatchObject({ imported: 0, skipped: 1 });
    expect((await server.inject({ method: "GET", url: "/api/v1/cases?agentId=langfuse-agent-other&domainId=other-domain" })).json().items).toHaveLength(0);
    const cases = await server.inject({ method: "GET", url: "/api/v1/cases?agentId=langfuse-agent&domainId=langfuse-domain" });
    expect(cases.json().items).toHaveLength(1);
    expect(cases.json().items[0]).toMatchObject({ source: "historical", content: '{"prompt":"customer question"}' });
    await server.close();
  });

  it("rejects Langfuse imports before outbound access when scope or connection is invalid", async () => {
    let calls = 0;
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
      fetch: async () => { calls += 1; return Response.json({}); },
    });
    const payload = {
      agentId: "missing-agent", domainId: "missing-domain", connectionId: "missing-connection",
      fromStartTime: "2026-11-03T00:00:00.000Z", toStartTime: "2026-11-04T00:00:00.000Z", limit: 1,
    };
    const response = await server.inject({ method: "POST", url: "/api/v1/cases/import-langfuse", payload });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "AGENT_SCOPE_INVALID" });
    expect(calls).toBe(0);
    await server.close();
  });

  it("maps malformed Langfuse capability responses to a sanitized unavailable error", async () => {
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
      fetch: async () => Response.json({ message: "remote secret details" }),
    });
    await server.inject({ method: "POST", url: "/api/v1/agents", payload: { id: "unavailable-agent", domainId: "unavailable-domain", name: "Unavailable" } });
    await server.inject({
      method: "POST", url: "/api/v1/connections",
      payload: { id: "unavailable-langfuse", kind: "langfuse", name: "Unavailable", credentials: { baseUrl: "https://langfuse.example", publicKey: "pk", secretKey: "sk" } },
    });
    const response = await server.inject({
      method: "POST", url: "/api/v1/cases/import-langfuse",
      payload: { agentId: "unavailable-agent", domainId: "unavailable-domain", connectionId: "unavailable-langfuse", fromStartTime: "2026-11-03T00:00:00.000Z", toStartTime: "2026-11-04T00:00:00.000Z", limit: 1 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "CONNECTION_UNAVAILABLE" });
    expect(response.body).not.toContain("remote secret details");
    await server.close();
  });
});