import { describe, expect, it } from "vitest";
import { transitionRound } from "./round.js";

describe("transitionRound", () => {
  it("allows setup to collection", () => {
    expect(transitionRound("setup", "collection_started")).toBe("collecting");
  });

  it("rejects evaluation before collection", () => {
    expect(() => transitionRound("setup", "evaluation_started")).toThrow("Invalid round transition");
  });

  it("allows cancellation from an active state", () => {
    expect(transitionRound("refining", "cancel_requested")).toBe("cancelled");
  });

  it("rejects cancellation from a terminal state", () => {
    expect(() => transitionRound("recommended", "cancel_requested")).toThrow(
      "Invalid round transition",
    );
  });
});
