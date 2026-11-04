import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../i18n/messages.js";
import { RoundsDashboard } from "./rounds-dashboard.js";

const t = (key: keyof typeof messages.en) => messages.en[key];

describe("RoundsDashboard", () => {
  afterEach(cleanup);

  it("loads agents and rounds, creates a round for the selected agent, and refreshes the list", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(init === undefined ? { url } : { url, init });
      if (url === "/api/v1/agents") return Response.json({ items: [{ id: "agent-1", domainId: "domain-1", name: "Support" }] });
      if (url.startsWith("/api/v1/cases?")) return Response.json({ items: [
        { id: "case-1", sessionId: "session-1", similarityGroup: "group-1", content: "Question one" },
        { id: "case-2", sessionId: "session-2", similarityGroup: "group-2", content: "Question two" },
      ] });
      if (url === "/api/v1/rounds" && init?.method === "POST") {
        return Response.json({ id: "round-new", agentId: "agent-1", domainId: "domain-1", objective: "Improve answers", state: "setup", createdAt: "2026-11-03T10:00:00.000Z" }, { status: 201 });
      }
      return Response.json({ items: [] });
    });
    render(<RoundsDashboard t={t} request={request as typeof fetch} eventSourceFactory={() => ({ close: vi.fn(), onopen: null, onerror: null })} />);

    await user.selectOptions(await screen.findByLabelText("Agent"), "agent-1");
    await user.type(screen.getByLabelText("Round objective"), "Improve answers");
    await user.click(screen.getByRole("button", { name: "Start round" }));

    await waitFor(() => expect(calls.some(({ url, init }) => url === "/api/v1/rounds" && init?.method === "POST")).toBe(true));
    const submitted = JSON.parse(String(calls.find(({ url, init }) => url === "/api/v1/rounds" && init?.method === "POST")?.init?.body));
    expect(submitted).toMatchObject({ agentId: "agent-1", domainId: "domain-1", objective: "Improve answers" });
    expect(await screen.findByText("round-new")).toBeVisible();
  });

  it("blocks round creation until the selected agent has at least two cases", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/agents") return Response.json({ items: [{ id: "agent-1", domainId: "domain-1", name: "Support" }] });
      if (url.startsWith("/api/v1/cases?")) return Response.json({ items: [
        { id: "case-1", sessionId: "session-1", similarityGroup: "group-1", content: "Question one" },
      ] });
      if (url === "/api/v1/rounds") return Response.json({ items: [] });
      return Response.json({});
    });
    render(<RoundsDashboard t={t} request={request as typeof fetch} eventSourceFactory={() => ({ close: vi.fn(), onopen: null, onerror: null })} />);

    await user.selectOptions(await screen.findByLabelText("Agent"), "agent-1");
    expect(await screen.findByText("At least two cases are required to start a round." )).toBeVisible();
    expect(screen.getByRole("button", { name: "Start round" })).toBeDisabled();
    expect(request.mock.calls.some(([input, init]) => String(input) === "/api/v1/rounds" && init?.method === "POST")).toBe(false);
  });

  it("shows the server readiness rejection if the corpus changes after the client check", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/agents") return Response.json({ items: [{ id: "agent-1", domainId: "domain-1", name: "Support" }] });
      if (url.startsWith("/api/v1/cases?")) return Response.json({ items: [
        { id: "case-1", sessionId: "session-1", similarityGroup: "group-1", content: "Question one" },
        { id: "case-2", sessionId: "session-2", similarityGroup: "group-2", content: "Question two" },
      ] });
      if (url === "/api/v1/rounds" && init?.method === "POST") {
        return Response.json({ code: "ROUND_CASES_INSUFFICIENT" }, { status: 422 });
      }
      return Response.json({ items: [] });
    });
    render(<RoundsDashboard t={t} request={request as typeof fetch} eventSourceFactory={() => ({ close: vi.fn(), onopen: null, onerror: null })} />);

    await user.selectOptions(await screen.findByLabelText("Agent"), "agent-1");
    await user.type(screen.getByLabelText("Round objective"), "Improve answers");
    await user.click(screen.getByRole("button", { name: "Start round" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("At least two cases are required to start a round.");
  });

  it("does not open an event stream for a missing deep-linked round", async () => {
    const eventSourceFactory = vi.fn(() => ({ close: vi.fn(), onopen: null, onerror: null }));
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/agents") return Response.json({ items: [] });
      if (url === "/api/v1/rounds") return Response.json({ items: [] });
      if (url === "/api/v1/rounds/missing") return Response.json({ code: "ROUND_NOT_FOUND" }, { status: 404 });
      return Response.json({});
    });
    render(<RoundsDashboard t={t} initialActiveRoundId="missing" request={request as typeof fetch} eventSourceFactory={eventSourceFactory} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("This round could not be found.");
    expect(eventSourceFactory).not.toHaveBeenCalled();
  });

  it("requests cooperative cancellation for the selected active round", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/agents") return Response.json({ items: [] });
      if (url === "/api/v1/rounds") return Response.json({ items: [{ id: "round-active", agentId: "a", domainId: "d", objective: "Improve", state: "executing", createdAt: "2026-11-03T10:00:00.000Z" }] });
      if (url === "/api/v1/rounds/round-active/cancel" && init?.method === "POST") return Response.json({ id: "round-active", cancellationRequested: true }, { status: 202 });
      return Response.json({});
    });
    render(<RoundsDashboard t={t} request={request as typeof fetch} eventSourceFactory={() => ({ close: vi.fn(), onopen: null, onerror: null })} />);
    await user.click(await screen.findByRole("button", { name: /round-active/u }));
    await user.click(screen.getByRole("button", { name: "Cancel round" }));
    expect(await screen.findByText(/Cancellation requested/u)).toBeVisible();
    expect(request).toHaveBeenCalledWith("/api/v1/rounds/round-active/cancel", expect.objectContaining({ method: "POST" }));
  });
});