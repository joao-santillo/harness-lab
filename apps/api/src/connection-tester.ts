import { ConnectionTestError, type ConnectionTester } from "@harness-lab/application";
import { LangfuseClient, negotiateLangfuseCapabilities } from "@harness-lab/adapters";

export class ExternalConnectionTester implements ConnectionTester {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async test(request: Parameters<ConnectionTester["test"]>[0]): Promise<void> {
    if (request.kind === "agent-platform") {
      const baseUrl = request.credentials.baseUrl;
      const token = request.credentials.token;
      if (!baseUrl || !token) throw new ConnectionTestError("CONNECTION_AUTH_FAILED");
      try {
        const url = new URL(baseUrl);
        if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        throw new ConnectionTestError("CONNECTION_UNAVAILABLE");
      }
      // Não há health-check oficial confirmado; isso valida apenas a configuração local, não a autenticação remota.
      return;
    }

    const { baseUrl, publicKey, secretKey } = request.credentials;
    if (!baseUrl || !publicKey || !secretKey) throw new ConnectionTestError("CONNECTION_AUTH_FAILED");
    try {
      const client = new LangfuseClient({ baseUrl, publicKey, secretKey, fetch: this.fetcher });
      await negotiateLangfuseCapabilities(client);
    } catch (error) {
      if (error instanceof Error && error.message === "LANGFUSE_INVALID_CREDENTIALS") {
        throw new ConnectionTestError("CONNECTION_AUTH_FAILED");
      }
      throw new ConnectionTestError("CONNECTION_UNAVAILABLE");
    }
  }
}