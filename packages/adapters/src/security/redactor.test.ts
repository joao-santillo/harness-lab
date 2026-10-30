import { describe, expect, it } from "vitest";
import { createRedactor } from "./redactor.js";

describe("createRedactor", () => {
  it("redacts sensitive keys recursively without mutating the input", () => {
    const input = {
      authorization: "Bearer abc",
      nested: { apiKey: "public", password: "password", stableCode: "CONNECTION_FAILED" },
    };

    const output = createRedactor()(input);

    expect(output).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", password: "[REDACTED]", stableCode: "CONNECTION_FAILED" },
    });
    expect(input.authorization).toBe("Bearer abc");
  });

  it("redacts configured values in strings and credential-bearing URLs", () => {
    const redact = createRedactor(["known-secret"]);

    expect(redact({
      message: "request failed for known-secret",
      url: "https://user:password@example.com/path?token=query-token&safe=yes",
    })).toEqual({
      message: "request failed for [REDACTED]",
      url: "https://%5BREDACTED%5D@example.com/path?token=%5BREDACTED%5D&safe=yes",
    });
  });

  it("handles arrays and circular structures", () => {
    const input: { token: string; values: unknown[]; self?: unknown } = { token: "abc", values: ["safe"] };
    input.self = input;

    const output = createRedactor()(input) as typeof input;

    expect(output.token).toBe("[REDACTED]");
    expect(output.values).toEqual(["safe"]);
    expect(output.self).toBe(output);
  });

  it("redacts embedded URL aliases and preserves stable error properties", () => {
    const error = Object.assign(
      new Error("failed at https://user:pass@example.com/path?access_token=abc"),
      { code: "CONNECTION_FAILED" },
    );

    expect(createRedactor()(error)).toMatchObject({
      name: "Error",
      message: "failed at https://%5BREDACTED%5D@example.com/path?access_token=%5BREDACTED%5D",
      code: "CONNECTION_FAILED",
    });
  });

  it("redacts percent-encoded configured secrets in URL components", () => {
    const redact = createRedactor(["a/b c"]);

    expect(redact({
      query: "https://example.com/?value=a%2Fb%20c",
      path: "https://example.com/a%2Fb%20c",
      user: "https://a%2Fb%20c@example.com/",
    })).toEqual({
      query: "https://example.com/?value=[REDACTED]",
      path: "https://example.com/[REDACTED]",
      user: "https://%5BREDACTED%5D@example.com/",
    });
  });
});