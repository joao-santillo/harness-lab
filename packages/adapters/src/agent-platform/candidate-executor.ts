import type { CandidateExecutionRequest, CandidateExecutor, ExecutionId, ExecutionResult } from "@harness-lab/domain";
import { z } from "zod";
import type { AgentPlatformClient } from "./client.js";

const acceptedSchema = z.object({ status: z.literal("accepted"), jobId: z.string() });
const pendingSchema = z.object({ status: z.enum(["accepted", "running"]) });
const resultSchema = z.object({
  status: z.enum(["completed", "failed", "cancelled"]),
  executionId: z.string(),
  traceId: z.string().nullable(),
  output: z.string().nullable(),
  metrics: z.object({
    latencyMs: z.number().nonnegative(),
    inputTokens: z.number().nonnegative().nullable().optional(),
    outputTokens: z.number().nonnegative().nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
  }),
});

interface CandidateExecutorOptions {
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export class AgentPlatformCandidateExecutor implements CandidateExecutor {
  readonly #client: AgentPlatformClient;
  readonly #delay: (milliseconds: number) => Promise<void>;
  readonly #pollIntervalMs: number;
  readonly #maxPolls: number;

  constructor(client: AgentPlatformClient, options: CandidateExecutorOptions = {}) {
    this.#client = client;
    this.#delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#maxPolls = options.maxPolls ?? 20;
  }

  async execute(request: CandidateExecutionRequest): Promise<ExecutionResult> {
    try {
      // O caminho está isolado no adapter e coberto por fixture; substitua-o somente após validar o OpenAPI do deployment.
      // O payload restringe a execução a teste e não inclui operação de publicação/promoção.
      const response = await this.#client.request("/api/test/executions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey },
        body: JSON.stringify({
          environment: "test",
          roundId: request.roundId,
          caseId: request.caseId,
          harnessVersionId: request.harnessVersionId,
          ...(request.kind === "candidate" ? { candidateId: request.candidateId } : {}),
          attempt: request.attempt,
          correlationId: request.idempotencyKey,
        }),
      });
      if (!response.ok) return this.#failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED");
      let payload: unknown = await response.json();
      if (response.status === 202) {
        const { jobId } = acceptedSchema.parse(payload);
        // Polling tem teto fixo para que job remoto travado não retenha lease/worker indefinidamente.
        for (let poll = 0; poll < this.#maxPolls; poll += 1) {
          await this.#delay(this.#pollIntervalMs);
          const jobResponse = await this.#client.request(`/api/test/executions/${encodeURIComponent(jobId)}`);
          if (!jobResponse.ok) return this.#failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED");
          payload = await jobResponse.json();
          if (!pendingSchema.safeParse(payload).success) return this.#result(request, resultSchema.parse(payload));
        }
        return this.#failure(request, "timed_out", "AGENT_PLATFORM_JOB_TIMEOUT");
      }
      return this.#result(request, resultSchema.parse(payload));
    } catch {
      return this.#failure(request, "integration_failed", "AGENT_PLATFORM_REQUEST_FAILED");
    }
  }

  #result(request: CandidateExecutionRequest, remote: z.infer<typeof resultSchema>): ExecutionResult {
    const status = remote.status === "completed" ? (remote.traceId === null ? "trace_missing" : "succeeded") : remote.status === "failed" ? "agent_failed" : "cancelled";
    return {
      id: remote.executionId as ExecutionId,
      roundId: request.roundId,
      caseId: request.caseId,
      harnessSnapshotId: request.harnessVersionId,
      status,
      correlationId: request.idempotencyKey,
      traceId: remote.traceId,
      output: remote.output,
      metrics: {
        inputTokens: remote.metrics.inputTokens ?? null,
        outputTokens: remote.metrics.outputTokens ?? null,
        cost: remote.metrics.cost ?? null,
        latencyMs: remote.metrics.latencyMs,
      },
      limitations: remote.traceId === null && remote.status === "completed" ? ["TRACE_CORRELATION_PENDING"] : [],
    };
  }

  #failure(request: CandidateExecutionRequest, status: ExecutionResult["status"], limitation: string): ExecutionResult {
    return {
      id: `${request.idempotencyKey}:${status}` as ExecutionId,
      roundId: request.roundId,
      caseId: request.caseId,
      harnessSnapshotId: request.harnessVersionId,
      status,
      correlationId: request.idempotencyKey,
      traceId: null,
      output: null,
      metrics: { inputTokens: null, outputTokens: null, cost: null, latencyMs: 0 },
      limitations: [limitation],
    };
  }
}