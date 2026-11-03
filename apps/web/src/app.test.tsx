import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

describe("operations interface", () => {
  afterEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    vi.restoreAllMocks();
  });

  it("supports navigation, locales, masked credentials, validation, and empty rounds", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => Response.json({ items: [] }));
    render(<App request={request as typeof fetch} eventSourceFactory={(url) => new FakeEventSource(url)} />);

    expect(screen.getByRole("navigation", { name: "Principal" })).toBeVisible();
    const agentsTab = screen.getByRole("tab", { name: "Agentes" });
    agentsTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Rodadas" })).toHaveFocus();
    expect(screen.getByText("Nenhum agente cadastrado")).toBeVisible();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Resultados" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Nenhum agente cadastrado")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Idioma"), "en");
    expect(screen.getByRole("tab", { name: "Agents" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Agents" }));

    const secret = screen.getByLabelText("Secret key");
    expect(secret).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    expect(screen.getByText("Complete all required fields.")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Language"), "es");
    expect(screen.getByRole("tab", { name: "Rondas" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardar conexión" })).toBeVisible();
  });

  it("reconnects an active round event stream", async () => {
    vi.useFakeTimers();
    render(<App activeRoundId="round-1" request={vi.fn(async () => Response.json({ items: [] })) as typeof fetch} eventSourceFactory={(url) => new FakeEventSource(url)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rodadas" }));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(screen.getByText("Conectando ao progresso...")) .toBeVisible();
    act(() => FakeEventSource.instances[0]?.onopen?.(new Event("open")));
    expect(screen.getByText("Progresso conectado")).toBeVisible();
    act(() => {
      FakeEventSource.instances[0]?.onerror?.(new Event("error"));
      FakeEventSource.instances[0]?.onerror?.(new Event("error"));
    });
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalledOnce();
    expect(screen.getByText("Reconectando ao progresso...")) .toBeVisible();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});