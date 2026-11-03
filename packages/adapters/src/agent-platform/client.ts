interface AgentPlatformClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export class AgentPlatformClient {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: AgentPlatformClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!new Set(["http:", "https:"]).has(this.#baseUrl.protocol)) throw new Error("AGENT_PLATFORM_URL_INVALID");
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetch ?? fetch;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.#fetch(new URL(path, this.#baseUrl), {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${this.#token}`, ...init.headers },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }
}