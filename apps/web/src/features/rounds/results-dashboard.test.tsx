import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../i18n/messages.js";
import { ResultsDashboard } from "./results-dashboard.js";

const t = (key: keyof typeof messages.en) => messages.en[key];

describe("ResultsDashboard", () => {
  afterEach(cleanup);

  it("loads persisted evaluation summaries for completed rounds", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/rounds") return Response.json({ items: [{ id: "round-done", state: "rejected", objective: "Improve answers" }] });
      return Response.json({ roundId: "round-done", decision: "rejected", sampleSize: 2, confidence: 0.75, rationale: "Regression gate failed.", limitations: [] });
    });
    render(<ResultsDashboard t={t} request={request as typeof fetch} />);

    expect(await screen.findByText("round-done")).toBeVisible();
    expect(screen.getByText("Rejected")).toBeVisible();
    expect(screen.getByText("Regression gate failed.")).toBeVisible();
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/rounds/round-done/results"));
  });

  it("keeps terminal rounds visible when their result is not ready yet", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/rounds") return Response.json({ items: [{ id: "round-pending", state: "integration_failed" }] });
      return Response.json({ code: "ROUND_RESULT_NOT_READY" }, { status: 409 });
    });
    render(<ResultsDashboard t={t} request={request as typeof fetch} />);

    expect(await screen.findByText("round-pending")).toBeVisible();
    expect(screen.getByText("Evaluation result is not available for this round.")).toBeVisible();
    expect(screen.queryByText("No results available")).toBeNull();
  });
});