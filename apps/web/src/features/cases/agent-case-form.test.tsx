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

    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: JSON.stringify([
      { id: "case-a", sessionId: "s-a", similarityGroup: "g-a", content: "Question A" },
      { id: "case-b", sessionId: "s-b", similarityGroup: "g-b", content: "Question B" },
    ]) } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [url, init] = request.mock.calls[1]!;
    expect(url).toBe("/api/v1/cases/import");
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      agentId: "support-agent", domainId: "support", source: "json", cases: expect.arrayContaining([expect.objectContaining({ id: "case-a" })]),
    }));
    expect(await screen.findByText("Cases imported successfully.")).toBeVisible();
  });

  it("rejects malformed JSON locally without making an API request", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 201 }));
    render(<AgentCaseForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Agent ID"), "agent-one");
    await user.type(screen.getByLabelText("Domain ID"), "domain-one");
    await user.type(screen.getByLabelText("Agent name"), "Agent one");
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Agent created.");
    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: "{broken" } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid JSON array of 1–40 cases");
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe("/api/v1/agents");

    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: JSON.stringify([{ id: "missing-fields" }]) } });
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid JSON array of 1–40 cases");
    expect(request).toHaveBeenCalledOnce();
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

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1]?.[0]).toBe("/api/v1/cases/import-csv");
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({ agentId: "csv-agent", domainId: "csv-domain", csv });
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
    fireEvent.change(screen.getByLabelText("Cases JSON"), { target: { value: JSON.stringify([{ id: "source-case", sessionId: "s", similarityGroup: "g", content: "Question" }]) } });

    await user.selectOptions(screen.getByLabelText("Case source"), "historical");
    await user.type(screen.getByLabelText("Historical source reference"), "dataset-2026-11");
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toMatchObject({ source: "historical", sourceReference: "dataset-2026-11" });

    await user.selectOptions(screen.getByLabelText("Case source"), "synthetic");
    await user.type(screen.getByLabelText("Synthetic data marker"), "SYNTHETIC");
    await user.click(screen.getByRole("button", { name: "Import cases" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body))).toMatchObject({
      source: "synthetic", cases: [{ id: "source-case", syntheticLabel: "SYNTHETIC" }],
    });
  });
});