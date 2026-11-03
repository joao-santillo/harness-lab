interface LangfuseClientOptions {
  readonly baseUrl: string;
  readonly publicKey: string;
  readonly secretKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export class LangfuseClient {
  readonly #baseUrl: URL;
  readonly #authorization: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: LangfuseClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!new Set(["http:", "https:"]).has(this.#baseUrl.protocol)) throw new Error("LANGFUSE_URL_INVALID");
    this.#authorization = `Basic ${Buffer.from(`${options.publicKey}:${options.secretKey}`, "utf8").toString("base64")}`;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#fetch = options.fetch ?? fetch;
  }

  async get(path: string): Promise<Response> {
    const url = new URL(path, this.#baseUrl);
    return this.#fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: this.#authorization },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }
}