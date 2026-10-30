import { describe, expect, it } from "vitest";
import { RegisterConnection, type ConnectionRegistrationStore, type ConnectionTester } from "./register-connection.js";

const request = {
  id: "langfuse-main",
  kind: "langfuse" as const,
  name: "Langfuse principal",
  credentials: { publicKey: "pk-live", secretKey: "sk-live" },
  idempotencyKey: "request-1",
};

describe("RegisterConnection", () => {
  it("tests credentials before atomically registering the connection", async () => {
    const calls: string[] = [];
    const tester: ConnectionTester = { test: async () => { calls.push("test"); } };
    const store: ConnectionRegistrationStore = {
      findReplay: async () => {
        calls.push("findReplay");
        return null;
      },
      register: async () => {
        calls.push("register");
        return { status: "created", connection: { id: request.id, kind: request.kind, name: request.name, configured: true } };
      },
    };

    const result = await new RegisterConnection(tester, store).execute(request);

    expect(calls).toEqual(["findReplay", "test", "register"]);
    expect(result.status).toBe("created");
  });

  it("does not persist credentials when the tester rejects them", async () => {
    const tester: ConnectionTester = { test: async () => { throw new Error("CONNECTION_TEST_FAILED"); } };
    let persisted = false;
    const store: ConnectionRegistrationStore = {
      findReplay: async () => null,
      register: async () => {
        persisted = true;
        throw new Error("unexpected");
      },
    };

    await expect(new RegisterConnection(tester, store).execute(request)).rejects.toThrow("CONNECTION_TEST_FAILED");
    expect(persisted).toBe(false);
  });

  it("returns a committed replay without testing the external connection again", async () => {
    let tested = false;
    const connection = { id: request.id, kind: request.kind, name: request.name, configured: true };
    const tester: ConnectionTester = { test: async () => { tested = true; } };
    const store: ConnectionRegistrationStore = {
      findReplay: async () => ({ status: "replayed", connection }),
      register: async () => { throw new Error("unexpected"); },
    };

    await expect(new RegisterConnection(tester, store).execute(request)).resolves.toEqual({ status: "replayed", connection });
    expect(tested).toBe(false);
  });
});