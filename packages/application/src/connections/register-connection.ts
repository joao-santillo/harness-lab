export type ConnectionKind = "langfuse" | "lynn";

export interface ConnectionView {
  readonly id: string;
  readonly kind: ConnectionKind;
  readonly name: string;
  readonly configured: boolean;
}

export interface RegisterConnectionRequest {
  readonly id: string;
  readonly kind: ConnectionKind;
  readonly name: string;
  readonly credentials: Readonly<Record<string, string>>;
  readonly idempotencyKey: string | null;
}

export interface ConnectionTester {
  test(request: Pick<RegisterConnectionRequest, "kind" | "credentials">): Promise<void>;
}

export class ConnectionTestError extends Error {
  public constructor(public readonly code: "CONNECTION_AUTH_FAILED" | "CONNECTION_UNAVAILABLE") {
    super(code);
  }
}

export interface RegistrationResult {
  readonly status: "created" | "replayed";
  readonly connection: ConnectionView;
}

export interface ConnectionRegistrationStore {
  findReplay(request: RegisterConnectionRequest): Promise<RegistrationResult | null>;
  register(request: RegisterConnectionRequest): Promise<RegistrationResult>;
}

export class RegisterConnection {
  public constructor(
    private readonly tester: ConnectionTester,
    private readonly store: ConnectionRegistrationStore,
  ) {}

  public async execute(request: RegisterConnectionRequest): Promise<RegistrationResult> {
    const replay = await this.store.findReplay(request);
    if (replay !== null) return replay;
    await this.tester.test({ kind: request.kind, credentials: request.credentials });
    return this.store.register(request);
  }
}