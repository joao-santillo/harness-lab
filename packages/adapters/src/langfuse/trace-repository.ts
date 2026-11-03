import type { CaseId, Evidence, EvidenceId, TracePage, TraceQuery, TraceRepository } from "@harness-lab/domain";
import { z } from "zod";
import type { LangfuseClient } from "./client.js";
import { normalizeObservations } from "./normalize.js";

const v2PageSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ page: z.number(), totalPages: z.number() }).passthrough(),
});
const legacyPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), input: z.unknown().optional(), output: z.unknown().optional(), timestamp: z.string() }).passthrough()),
  meta: z.object({ page: z.number(), totalPages: z.number() }).passthrough(),
});

interface LangfuseTraceRepositoryOptions {
  readonly client: LangfuseClient;
  readonly projectId: string;
  readonly observationsApi: "v2" | "legacy";
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export class LangfuseTraceRepository implements TraceRepository {
  readonly #client: LangfuseClient;
  readonly #projectId: string;
  readonly #observationsApi: "v2" | "legacy";
  readonly #delay: (milliseconds: number) => Promise<void>;

  constructor(options: LangfuseTraceRepositoryOptions) {
    this.#client = options.client;
    this.#projectId = options.projectId;
    this.#observationsApi = options.observationsApi;
    this.#delay = options.delay ?? (async () => undefined);
  }

  async #getWithRetry(path: string): Promise<Response> {
    let response = await this.#client.get(path);
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after") ?? "1");
      // O servidor pode pedir espera longa; limitamos a 30s e fazemos só uma nova tentativa por página.
      await this.#delay(Math.min(Math.max(seconds, 0), 30) * 1000);
      response = await this.#client.get(path);
    }
    if (!response.ok) throw new Error(response.status === 429 ? "LANGFUSE_RATE_LIMITED" : "LANGFUSE_TRACE_COLLECTION_FAILED");
    return response;
  }

  async collect(query: TraceQuery): Promise<TracePage> {
    const firstPage = Number(query.cursor ?? "1");
    const evidence: Evidence[] = [];
    let currentPage = firstPage;
    let totalPages = firstPage;
    while (currentPage <= totalPages && evidence.length < query.limit) {
      if (this.#observationsApi === "v2") {
        const parameters = new URLSearchParams({
          page: String(currentPage), limit: String(Math.min(query.limit, 100)),
          fromStartTime: query.from, toStartTime: query.to,
        });
        const response = await this.#getWithRetry(`/api/public/v2/observations?${parameters}`);
        const body = v2PageSchema.parse(await response.json());
        totalPages = body.meta.totalPages;
        const normalized = normalizeObservations(this.#projectId, body.data);
        evidence.push(...normalized.observations.map((observation) => ({
          kind: "trace" as const,
          id: `${this.#projectId}:${observation.id}` as EvidenceId,
          roundId: query.roundId,
          caseId: observation.traceId as CaseId,
          traceId: observation.traceId,
          observationId: observation.id,
          excerpt: JSON.stringify({ input: observation.input, output: observation.output }).slice(0, 1000),
          sourceUrl: null,
        })));
      } else {
        const parameters = new URLSearchParams({ page: String(currentPage), limit: String(Math.min(query.limit, 100)), fromTimestamp: query.from, toTimestamp: query.to });
        const response = await this.#getWithRetry(`/api/public/traces?${parameters}`);
        const body = legacyPageSchema.parse(await response.json());
        totalPages = body.meta.totalPages;
        evidence.push(...body.data.map((trace) => ({
          kind: "trace" as const,
          id: `${this.#projectId}:${trace.id}` as EvidenceId,
          roundId: query.roundId,
          caseId: trace.id as CaseId,
          traceId: trace.id,
          observationId: null,
          excerpt: JSON.stringify({ input: trace.input ?? null, output: trace.output ?? null }).slice(0, 1000),
          sourceUrl: null,
        })));
      }
      currentPage += 1;
    }
    // Chave inclui projeto e observation/trace ID, evitando duplicata sem colapsar traces de projetos diferentes.
    const deduplicated = [...new Map(evidence.map((item) => [item.id, item])).values()].slice(0, query.limit);
    return { evidence: deduplicated, nextCursor: currentPage <= totalPages ? String(currentPage) : null };
  }
}