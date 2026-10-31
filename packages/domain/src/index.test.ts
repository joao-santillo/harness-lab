import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index.js";

describe("domain package", () => {
  it("exports the product identity", () => {
    expect(APP_NAME).toBe("Harness Lab");
  });
});