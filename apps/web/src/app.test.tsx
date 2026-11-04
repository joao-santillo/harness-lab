import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  listeners = new Map<string, EventListener>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  dispatch(type: string, data: unknown) {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe("operations interface", () => {
  afterEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("supports resource routes, locales, masked credentials, and empty rounds", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => Response.json({ items: [] }));
    render(<App request={request as typeof fetch} eventSourceFactory={(url) => new FakeEventSource(url)} />);

    expect(screen.getByRole("navigation", { name: "Principal" })).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Agentes" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("link", { name: "Conexões" }));
    expect(window.location.pathname).toBe("/connections");
    expect(screen.getByRole("heading", { name: "Integrações do workspace" })).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Idioma"), "en");
    expect(screen.getByRole("link", { name: "Agents" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Rounds" }));
    expect(window.location.pathname).toBe("/rounds");
    expect(screen.getByRole("heading", { name: "Rounds" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Results" }));
    expect(window.location.pathname).toBe("/results");

    await user.selectOptions(screen.getByLabelText("Language"), "es");
    expect(screen.getByRole("link", { name: "Conexiones" })).toBeVisible();
  });

  it("reconnects an active round stream without replaying progress backwards", async () => {
    window.history.replaceState({}, "", "/rounds/round-1");
    const request = vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/v1/rounds/round-1"
      ? Response.json({ id: "round-1", agentId: "agent-1", domainId: "domain-1", objective: "Improve", state: "collecting", createdAt: "2026-11-04T10:00:00.000Z" })
      : Response.json({ items: [] }));
    render(<App activeRoundId="round-1" request={request as typeof fetch} eventSourceFactory={(url) => new FakeEventSource(url)} />);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(screen.getByText("Conectando ao progresso...")) .toBeVisible();
    act(() => FakeEventSource.instances[0]?.onopen?.(new Event("open")));
    expect(screen.getByText("Progresso conectado")).toBeVisible();
    act(() => {
      FakeEventSource.instances[0]?.onerror?.(new Event("error"));
      FakeEventSource.instances[0]?.onerror?.(new Event("error"));
    });
    expect(FakeEventSource.instances[0]?.close).not.toHaveBeenCalled();
    expect(screen.getByText("Reconectando ao progresso...")) .toBeVisible();
    act(() => FakeEventSource.instances[0]?.onopen?.(new Event("open")));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => FakeEventSource.instances[0]?.dispatch("round-progress", {
      id: "event-2", roundId: "round-1", sequence: 2, event: "refinement_started",
      state: "refining", occurredAt: "2026-11-04T10:00:02.000Z", messageCode: "ROUND_REFINEMENT_STARTED",
    }));
    act(() => FakeEventSource.instances[0]?.dispatch("round-progress", {
      id: "event-1", roundId: "round-1", sequence: 1, event: "collection_started",
      state: "collecting", occurredAt: "2026-11-04T10:00:01.000Z", messageCode: "ROUND_COLLECTION_STARTED",
    }));
    expect(screen.getByText("Progresso da rodada: refining")).toBeVisible();
  });

  it("opens a deep-linked agent case import route", async () => {
    window.history.replaceState({}, "", "/agents/agent-1/cases/import");
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/agents") return Response.json({ items: [{ id: "agent-1", domainId: "domain-1", name: "Support" }] });
      if (String(input).startsWith("/api/v1/cases?")) return Response.json({ items: [] });
      return Response.json({ items: [] });
    });
    render(<App request={request as typeof fetch} eventSourceFactory={(url) => new FakeEventSource(url)} />);

    expect(await screen.findByRole("heading", { name: "Importar casos JSON" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Navegação estrutural" })).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Agentes" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(screen.getByRole("button", { name: "Importar casos" })).toBeEnabled());
  });

  it("loads a selected evaluation result from its resource URL", async () => {
    window.history.replaceState({}, "", "/results/round-result");
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/rounds/round-result") return Response.json({ id: "round-result", state: "rejected" });
      if (url.endsWith("/results")) return Response.json({ roundId: "round-result", decision: "rejected", sampleSize: 2, confidence: 0.75, rationale: "Regression gate failed.", limitations: [] });
      return Response.json({ items: [] });
    });
    render(<App request={request as typeof fetch} eventSourceFactory={(url) => new FakeEventSource(url)} />);

    expect(await screen.findByText("Regression gate failed.")).toBeVisible();
    expect(request).toHaveBeenCalledWith("/api/v1/rounds/round-result/results");
  });
});