import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../i18n/messages.js";
import { AgentCaseForm } from "./agent-case-form.js";

const t = (key: keyof typeof messages.en) => messages.en[key];

describe("AgentCaseForm", () => {
  afterEach(cleanup);

  it("creates an agent and imports a JSON case batch using the selected scope", async () => {
    const user = userEvent.setup();
    let responseNumber = 0;
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      responseNumber += 1;
      return new Response(JSON.stringify(responseNumber === 1 ? { id: "support-agent" } : { imported: 2 }), { status: 201 });
    });
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);

    await user.type(screen.getByLabelText("Agent ID"), "support-agent");
    await user.type(screen.getByLabelText("Domain ID"), "support");
    await user.type(screen.getByLabelText("Agent name"), "Support");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await expect(screen.findByText("Agent created.")).resolves.toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Case source"), "json");
    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: JSON.stringify([
      { id: "case-a", sessionId: "s-a", similarityGroup: "g-a", content: "Question A" },
      { id: "case-b", sessionId: "s-b", similarityGroup: "g-b", content: "Question B" },
    ]) } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));

    await waitFor(() => expect(request.mock.calls.some(([input]) => input === "/api/v1/cases/import")).toBe(true));
    const [url, init] = request.mock.calls.find(([input]) => input === "/api/v1/cases/import")!;
    expect(url).toBe("/api/v1/cases/import");
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      agentId: "support-agent", domainId: "support", source: "json", cases: expect.arrayContaining([expect.objectContaining({ id: "case-a" })]),
    }));
    expect(await screen.findByText("Cases imported successfully.")).toBeVisible();
  });

  it("rejects malformed JSON locally without making an API request", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      input === "/api/v1/agents" ? Response.json({ items: [] }) : new Response(null, { status: 201 }));
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Agent ID"), "agent-one");
    await user.type(screen.getByLabelText("Domain ID"), "domain-one");
    await user.type(screen.getByLabelText("Agent name"), "Agent one");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Agent created.");
    await user.selectOptions(screen.getByLabelText("Case source"), "json");
    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: "{broken" } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid JSON array of 1–40 cases");
    expect(request.mock.calls.filter(([input]) => input === "/api/v1/agents").length).toBe(3);

    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: JSON.stringify([{ id: "missing-fields" }]) } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid JSON array of 1–40 cases");
    expect(request.mock.calls.filter(([input]) => input === "/api/v1/agents").length).toBe(3);
  });

  it("disables case import when the visible agent/domain scope changes after registration", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 201 }));
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Agent ID"), "agent-one");
    await user.type(screen.getByLabelText("Domain ID"), "domain-one");
    await user.type(screen.getByLabelText("Agent name"), "Agent one");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Agent created.");
    expect(screen.getByRole("button", { name: "Import cases" })).toBeEnabled();

    await user.type(screen.getByLabelText("Domain ID"), "-other");
    expect(screen.getByRole("button", { name: "Import cases" })).toBeDisabled();
  });

  it("submits CSV text to the dedicated CSV endpoint", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 201 }));
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Agent ID"), "csv-agent");
    await user.type(screen.getByLabelText("Domain ID"), "csv-domain");
    await user.type(screen.getByLabelText("Agent name"), "CSV agent");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Agent created.");
    await user.selectOptions(screen.getByLabelText("File format"), "csv");
    const csv = "id,sessionId,similarityGroup,content\ncase-1,s-1,g-1,Question";
    fireEvent.change(screen.getByLabelText("Cases CSV"), { target: { value: csv } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));

    await waitFor(() => expect(request.mock.calls.some(([input]) => input === "/api/v1/cases/import-csv")).toBe(true));
    const csvCall = request.mock.calls.find(([input]) => input === "/api/v1/cases/import-csv");
    expect(csvCall?.[0]).toBe("/api/v1/cases/import-csv");
    expect(JSON.parse(String(csvCall?.[1]?.body))).toEqual({ agentId: "csv-agent", domainId: "csv-domain", csv });
  });

  it("includes historical references and a synthetic marker in imported provenance", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 201 }));
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Agent ID"), "source-agent");
    await user.type(screen.getByLabelText("Domain ID"), "source-domain");
    await user.type(screen.getByLabelText("Agent name"), "Source");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Agent created.");
    await user.selectOptions(screen.getByLabelText("Case source"), "json");
    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: JSON.stringify([{ id: "source-case", sessionId: "s", similarityGroup: "g", content: "Question" }]) } });

    await user.selectOptions(screen.getByLabelText("Case source"), "historical");
    await user.type(screen.getByLabelText("Historical source reference"), "dataset-2026-11");
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    await waitFor(() => expect(request.mock.calls.some(([input]) => input === "/api/v1/cases/import")).toBe(true));
    const historicalCall = request.mock.calls.find(([input]) => input === "/api/v1/cases/import");
    expect(JSON.parse(String(historicalCall?.[1]?.body))).toMatchObject({ source: "historical", sourceReference: "dataset-2026-11" });

    await user.selectOptions(screen.getByLabelText("Case source"), "synthetic");
    await user.type(screen.getByLabelText("Synthetic data marker"), "SYNTHETIC");
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    await waitFor(() => expect(request.mock.calls.filter(([input]) => input === "/api/v1/cases/import").length).toBe(2));
    const syntheticCall = request.mock.calls.filter(([input]) => input === "/api/v1/cases/import")[1];
    expect(JSON.parse(String(syntheticCall?.[1]?.body))).toMatchObject({
      source: "synthetic", cases: [{ id: "source-case", syntheticLabel: "SYNTHETIC" }],
    });
  });

  it("imports from a saved Langfuse connection with bounded ISO dates and shows counts", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (input === "/api/v1/agents") return new Response("{}", { status: 201 });
      if (input === "/api/v1/connections") return Response.json({ items: [
        { id: "langfuse-one", kind: "langfuse", name: "Primary Langfuse" },
        { id: "agent-platform-one", kind: "agent-platform", name: "Agent Platform" },
      ] });
      return Response.json({ imported: 2, skipped: 1, limitations: ["Legacy endpoint"] }, { status: 201 });
    });
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Agent ID"), "agent-one");
    await user.type(screen.getByLabelText("Domain ID"), "domain-one");
    await user.type(screen.getByLabelText("Agent name"), "Agent one");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Agent created.");
    await user.selectOptions(screen.getByLabelText("Case source"), "langfuse");
    await screen.findByRole("option", { name: "Primary Langfuse" });
    expect(screen.queryByRole("option", { name: "Agent Platform" })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Langfuse connection"), "langfuse-one");
    fireEvent.change(screen.getByLabelText("Window start"), { target: { value: "2026-11-03T10:00" } });
    fireEvent.change(screen.getByLabelText("Window end"), { target: { value: "2026-11-03T11:00" } });
    await user.selectOptions(screen.getByLabelText("Langfuse field"), "traceName");
    await user.type(screen.getByLabelText("Filter value"), "support-flow");
    await user.click(screen.getByRole("button", { name: "Import cases" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/cases/import-langfuse", expect.anything()));
    const init = request.mock.calls.find(([input]) => input === "/api/v1/cases/import-langfuse")?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      agentId: "agent-one", domainId: "domain-one", connectionId: "langfuse-one", limit: 20,
      filter: { field: "traceName", value: "support-flow" },
    }));
    expect(body.fromStartTime).toMatch(/^2026-11-03T\d{2}:00:00\.000Z$/);
    expect(body.toStartTime).toMatch(/^2026-11-03T\d{2}:00:00\.000Z$/);
    expect(Date.parse(String(body.toStartTime)) - Date.parse(String(body.fromStartTime))).toBe(3_600_000);
    expect(await screen.findByText("Imported: 2. Skipped: 1.")).toBeVisible();
    expect(await screen.findByText("Legacy endpoint")).toBeVisible();
  });

  it("ignores a slow case response after the route changes to another agent", async () => {
    let resolveOldCases!: (response: Response) => void;
    const oldCases = new Promise<Response>((resolve) => { resolveOldCases = resolve; });
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/agents") return Promise.resolve(Response.json({ items: [
        { id: "agent-old", domainId: "domain-old", name: "Old" },
        { id: "agent-new", domainId: "domain-new", name: "New" },
      ] }));
      if (url.includes("agentId=agent-old")) return oldCases;
      if (url.includes("agentId=agent-new")) return Promise.resolve(Response.json({ items: [
        { id: "case-new", sessionId: "session-new", similarityGroup: "group-new", content: "New agent case" },
      ] }));
      return Promise.resolve(Response.json({ items: [] }));
    });
    const props = { t, request: request as typeof fetch, initialStep: 3 as const };
    const { rerender } = render(<AgentCaseForm {...props} initialAgentId="agent-old" />);

    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining("agentId=agent-old")));
    rerender(<AgentCaseForm {...props} initialAgentId="agent-new" />);
    expect(await screen.findByText("New agent case")).toBeVisible();
    resolveOldCases(Response.json({ items: [
      { id: "case-old", sessionId: "session-old", similarityGroup: "group-old", content: "Old agent case" },
    ] }));

    await waitFor(() => expect(screen.queryByText("Old agent case")).toBeNull());
    expect(screen.getByText("New agent case")).toBeVisible();
  });
});