import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../i18n/messages.js";
import { ConnectionForm } from "./connection-form.js";

const t = (key: keyof typeof messages.en) => messages.en[key];

describe("ConnectionForm", () => {
  afterEach(cleanup);

  it("submits Langfuse URL and keys to the API and clears credentials after success", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "langfuse-main", configured: true }), { status: 201 }));
    render(<ConnectionForm t={t} request={request as typeof fetch} />);

    await user.type(screen.getByLabelText("Connection name"), "Langfuse main");
    await user.type(screen.getByLabelText("Base URL"), "https://langfuse.example");
    await user.type(screen.getByLabelText("Public key"), "pk-example");
    await user.type(screen.getByLabelText("Secret key"), "sk-example");
    await user.click(screen.getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("/api/v1/connections");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("idempotency-key")).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      kind: "langfuse",
      credentials: { baseUrl: "https://langfuse.example", publicKey: "pk-example", secretKey: "sk-example" },
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connection saved securely.");
    expect(screen.getByLabelText("Secret key")).toHaveValue("");
  });

  it("submits the Agent Platform token instead of Langfuse key fields", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "platform-main", configured: true }), { status: 201 }));
    render(<ConnectionForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Connection name"), "Platform main");
    await user.selectOptions(screen.getByLabelText("Integration"), "agent-platform");
    await user.type(screen.getByLabelText("Base URL"), "https://platform.example");
    await user.type(screen.getByLabelText("Agent Platform token"), "platform-token");
    await user.click(screen.getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const [, init] = request.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      kind: "agent-platform",
      credentials: { baseUrl: "https://platform.example", token: "platform-token" },
    }));
    expect(screen.queryByLabelText("Public key")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent Platform token")).toHaveValue("");
  });

  it("shows API failures and clears credentials instead of reporting success", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ code: "CONNECTION_AUTH_FAILED" }), { status: 422 }));
    render(<ConnectionForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Connection name"), "Langfuse main");
    await user.type(screen.getByLabelText("Base URL"), "https://langfuse.example");
    await user.type(screen.getByLabelText("Public key"), "pk-example");
    await user.type(screen.getByLabelText("Secret key"), "sk-example");
    await user.click(screen.getByRole("button", { name: "Save connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Credentials were rejected.");
    expect(screen.queryByText("Connection saved securely.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Secret key")).toHaveValue("");
  });

  it("reuses the same idempotency identity when retrying the same connection after a network failure", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify(attempts++ === 0 ? { code: "CONNECTION_UNAVAILABLE" } : { id: "saved", configured: true }),
      { status: attempts === 1 ? 503 : 201 },
    ));
    render(<ConnectionForm t={t} request={request as typeof fetch} />);
    await user.type(screen.getByLabelText("Connection name"), "Langfuse main");
    await user.type(screen.getByLabelText("Base URL"), "https://langfuse.example");
    await user.type(screen.getByLabelText("Public key"), "pk-example");
    await user.type(screen.getByLabelText("Secret key"), "sk-example");
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The service could not be reached");

    await user.type(screen.getByLabelText("Public key"), "pk-example");
    await user.type(screen.getByLabelText("Secret key"), "sk-example");
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const first = request.mock.calls[0]!;
    const second = request.mock.calls[1]!;
    expect(new Headers(first[1]?.headers).get("idempotency-key")).toBe(new Headers(second[1]?.headers).get("idempotency-key"));
    expect(JSON.parse(String(first[1]?.body)).id).toBe(JSON.parse(String(second[1]?.body)).id);
    expect(await screen.findByRole("status")).toHaveTextContent("Connection saved securely.");
  });
});