import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../i18n/messages.js";
import { ConnectionsList } from "./connections-list.js";

const t = (key: keyof typeof messages.en) => messages.en[key];

describe("ConnectionsList", () => {
  afterEach(cleanup);

  it("loads saved Langfuse and Agent Platform connections without rendering secrets", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      items: [
        { id: "langfuse-main", kind: "langfuse", name: "Langfuse principal", configured: true },
        { id: "agent-platform-main", kind: "agent-platform", name: "Agent Platform principal", configured: true },
      ],
    }), { status: 200 }));

    render(<ConnectionsList t={t} request={request as typeof fetch} />);

    expect(await screen.findByText("Langfuse principal")).toBeInTheDocument();
    expect(screen.getByText("Agent Platform principal")).toBeInTheDocument();
    expect(screen.getByText("Langfuse")).toBeInTheDocument();
    expect(screen.getByText("Agent Platform")).toBeInTheDocument();
    expect(screen.queryByText("sk-secret")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/api/v1/connections");
  });

  it("shows an empty state when no connections are saved", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));

    render(<ConnectionsList t={t} request={request as typeof fetch} />);

    await waitFor(() => expect(screen.getByText("No saved connections")).toBeInTheDocument());
    expect(screen.getByText("Register a connection above to start using it.")).toBeInTheDocument();
  });
});
