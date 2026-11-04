import { z } from "zod";
import type { LangfuseClient } from "./client.js";

const MAX_IMPORT_LIMIT = 40;
const MAX_IMPORT_PAGES = 100;
const MAX_IMPORT_OBSERVATIONS = 1_000;
const MAX_IMPORT_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_SIMILARITY_GROUP_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;
const MAX_SOURCE_REFERENCE_LENGTH = 500;
const MAX_RETRY_AFTER_MS = 30_000;

const observationPageSchema = z.object({
  data: z.unknown(),
  meta: z.object({ cursor: z.string().nullable().optional() }).passthrough(),
}).passthrough();
const observationSchema = z.object({
  id: z.string().optional(),
  traceId: z.string().min(1).refine((value) => value.trim().length > 0),
  startTime: z.string(),
  parentObservationId: z.string().nullable().optional(),
  isRootObservation: z.boolean().optional(),
  sessionId: z.string().nullable().optional(),
  traceName: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  input: z.unknown().optional(),
}).passthrough();
const legacyPageSchema = z.object({
  data: z.unknown(),
  meta: z.object({ page: z.number().int().positive(), totalPages: z.number().int().positive() }).passthrough(),
}).passthrough();
const legacyTraceSchema = z.object({
  id: z.string().min(1),
  input: z.unknown().optional(),
  timestamp: z.string(),
  sessionId: z.string().nullable().optional(),
  traceName: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
}).passthrough();

export interface LangfuseCaseImportCandidate {
  readonly traceId: string;
  readonly sessionId: string;
  readonly similarityGroup: string;
  readonly content: string;
  readonly startTime: string;
}

export interface LangfuseCaseImportResult {
  readonly candidates: readonly LangfuseCaseImportCandidate[];
  readonly skipped: number;
  readonly limitations: readonly string[];
}

export interface LangfuseCaseImportQuery {
  readonly fromStartTime: string;
  readonly toStartTime: string;
  readonly limit: number;
  readonly filter?: LangfuseCaseImportFilter;
}

export interface LangfuseCaseImportFilter {
  readonly field: "traceName" | "environment" | "tags" | "userId" | "sessionId";
  readonly value: string;
}

interface LangfuseCaseImportRepositoryOptions {
  readonly client: LangfuseClient;
  readonly observationsApi: "v2" | "legacy";
  readonly sourceReferencePrefix: string;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

type TraceObservation = z.infer<typeof observationSchema>;

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function serializeInput(input: unknown): string | null {
  if (typeof input === "string") return input.trim().length > 0 ? input : null;
  if (input === null || typeof input !== "object") return null;
  if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype) return null;
  try {
    const serialized = JSON.stringify(input);
    return typeof serialized === "string" && serialized.trim().length > 0 ? serialized : null;
  } catch {
    return null;
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function retryAfterMilliseconds(value: string | null): number {
  if (value === null) return 1_000;
  const seconds = Number(value);
  const requestedMs = Number.isFinite(seconds)
    ? seconds * 1_000
    : Math.max(0, Date.parse(value) - Date.now());
  if (!Number.isFinite(requestedMs)) return 1_000;
  return Math.min(Math.max(requestedMs, 0), MAX_RETRY_AFTER_MS);
}

function sanitizedError(code: "LANGFUSE_INVALID_CREDENTIALS" | "LANGFUSE_RATE_LIMITED" | "LANGFUSE_CASE_IMPORT_FAILED"): Error {
  return new Error(code);
}

function sanitizedLimitError(): Error {
  return new Error("LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED");
}

function sanitizedResponseTooLargeError(): Error {
  return new Error("LANGFUSE_CASE_IMPORT_RESPONSE_TOO_LARGE");
}

export class LangfuseCaseImportRepository {
  readonly #client: LangfuseClient;
  readonly #observationsApi: "v2" | "legacy";
  readonly #sourceReferencePrefix: string;
  readonly #delay: (milliseconds: number) => Promise<void>;

  constructor(options: LangfuseCaseImportRepositoryOptions) {
    this.#client = options.client;
    this.#observationsApi = options.observationsApi;
    this.#sourceReferencePrefix = options.sourceReferencePrefix;
    this.#delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async #get(path: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.#client.get(path);
      if (response.status === 429) {
        await this.#delay(retryAfterMilliseconds(response.headers.get("retry-after")));
        response = await this.#client.get(path);
      }
    } catch {
      throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
    }

    if (response.status === 401 || response.status === 403) throw sanitizedError("LANGFUSE_INVALID_CREDENTIALS");
    if (response.status === 429) throw sanitizedError("LANGFUSE_RATE_LIMITED");
    if (!response.ok) throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
    return response;
  }

  #parsePage<T>(schema: z.ZodType<T>, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
    }
  }

  async #readJson(response: Response): Promise<unknown> {
    const body = response.body;
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && /^\d+$/.test(contentLength.trim())
      && Number(contentLength) > MAX_IMPORT_RESPONSE_BYTES) {
      if (body !== null) {
        try {
          await body.cancel();
        } catch {
          // Keep the rejection sanitized even if the body cannot be cancelled.
        }
      }
      throw sanitizedResponseTooLargeError();
    }
    if (body === null || body === undefined) throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (totalBytes + value.byteLength > MAX_IMPORT_RESPONSE_BYTES) {
          try {
            void reader.cancel().catch(() => undefined);
          } catch {
            // The size-limit error takes precedence over cancellation failures.
          }
          throw sanitizedResponseTooLargeError();
        }
        chunks.push(value);
        totalBytes += value.byteLength;
      }

      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
      if (error instanceof Error && error.message === "LANGFUSE_CASE_IMPORT_RESPONSE_TOO_LARGE") throw error;
      throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
    } finally {
      reader.releaseLock();
    }
  }

  #observations(data: readonly unknown[]): readonly TraceObservation[] {
    return this.#parsePage(z.array(observationSchema), data);
  }

  #isRootObservation(observation: TraceObservation): boolean {
    return observation.isRootObservation === true
      || (observation.isRootObservation === undefined && observation.parentObservationId === null);
  }

  #toCandidate(observations: readonly TraceObservation[]): { candidate: LangfuseCaseImportCandidate | null; skipped: boolean } {
    const roots = observations.filter((observation) => this.#isRootObservation(observation));
    if (roots.length === 0) return { candidate: null, skipped: false };

    const ordered = observations
      .map((observation) => ({ observation, isRoot: this.#isRootObservation(observation) }))
      .sort((left, right) => {
        if (left.isRoot !== right.isRoot) return left.isRoot ? -1 : 1;
        const timeDifference = Date.parse(left.observation.startTime) - Date.parse(right.observation.startTime);
        if (timeDifference !== 0) return timeDifference;
        return (left.observation.id ?? "").localeCompare(right.observation.id ?? "");
      });

    for (const { observation } of ordered) {
      const content = serializeInput(observation.input);
      if (content === null || !isValidDate(observation.startTime)
        || content.length > MAX_CONTENT_LENGTH
        || this.#sourceReferencePrefix.length + observation.traceId.length > MAX_SOURCE_REFERENCE_LENGTH) continue;

      const traceId = observation.traceId;
      const requestedSessionId = nonEmpty(observation.sessionId);
      const sessionId = requestedSessionId !== null && requestedSessionId.length <= MAX_SESSION_ID_LENGTH
        ? requestedSessionId
        : traceId;
      if (sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH) continue;

      const similarityGroup = [observation.traceName, observation.name]
        .map(nonEmpty)
        .find((value): value is string => value !== null && value.length <= MAX_SIMILARITY_GROUP_LENGTH) ?? "langfuse";
      return {
        candidate: { traceId, sessionId, similarityGroup, content, startTime: observation.startTime },
        skipped: false,
      };
    }

    return { candidate: null, skipped: true };
  }

  async importCases(query: LangfuseCaseImportQuery): Promise<LangfuseCaseImportResult> {
    const from = Date.parse(query.fromStartTime);
    const to = Date.parse(query.toStartTime);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to
      || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_IMPORT_LIMIT) {
      throw new Error("CASE_LANGFUSE_INVALID");
    }

    const observationsByTrace = new Map<string, TraceObservation[]>();
    const limitations: string[] = [];
    const seenCursors = new Set<string>();
    let pagesRead = 0;
    let observationsRead = 0;

    const takeObservationBudget = (data: unknown[]): { observations: unknown[]; truncated: boolean } => {
      const remaining = MAX_IMPORT_OBSERVATIONS - observationsRead;
      const observations = data.slice(0, remaining);
      observationsRead += observations.length;
      return { observations, truncated: observations.length < data.length };
    };

    if (this.#observationsApi === "legacy") limitations.push("Langfuse legacy trace endpoint is deprecated.");

    const addRoots = (observations: readonly TraceObservation[]): void => {
      for (const observation of observations) {
        const roots = observationsByTrace.get(observation.traceId) ?? [];
        roots.push(observation);
        observationsByTrace.set(observation.traceId, roots);
      }
    };

    const currentCandidates = (): { candidates: LangfuseCaseImportCandidate[]; skipped: number } => {
      const candidates: LangfuseCaseImportCandidate[] = [];
      let rejected = 0;
      for (const observations of observationsByTrace.values()) {
        const mapped = this.#toCandidate(observations);
        if (mapped.candidate) candidates.push(mapped.candidate);
        else if (mapped.skipped) rejected += 1;
      }
      candidates.sort((left, right) => {
        const timeDifference = Date.parse(left.startTime) - Date.parse(right.startTime);
        return timeDifference !== 0 ? timeDifference : left.traceId.localeCompare(right.traceId);
      });
      return { candidates, skipped: rejected };
    };

    if (this.#observationsApi === "v2") {
      let cursor: string | null = null;
      while (true) {
        const parameters = new URLSearchParams({
          fromStartTime: query.fromStartTime,
          toStartTime: query.toStartTime,
          fields: "core,basic,io,trace_context",
          limit: String(query.limit),
        });
        if (query.filter !== undefined) {
          if (query.filter.field === "environment" || query.filter.field === "userId" || query.filter.field === "sessionId") {
            parameters.set(query.filter.field, query.filter.value);
          } else {
            const selectedFilter = query.filter.field === "traceName"
              ? { type: "string", column: "traceName", operator: "=", value: query.filter.value }
              : { type: "arrayOptions", column: "tags", operator: "any of", value: [query.filter.value] };
            parameters.set("filter", JSON.stringify([
              { type: "datetime", column: "startTime", operator: ">=", value: query.fromStartTime },
              { type: "datetime", column: "startTime", operator: "<", value: query.toStartTime },
              selectedFilter,
            ]));
          }
        }
        if (cursor !== null) parameters.set("cursor", cursor);
        const response = await this.#get(`/api/public/v2/observations?${parameters}`);
        const body = this.#parsePage(observationPageSchema, await this.#readJson(response));
        if (!Array.isArray(body.data)) throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
        pagesRead += 1;
        const pageData = takeObservationBudget(body.data);
        if (pageData.truncated) throw sanitizedLimitError();
        addRoots(this.#observations(pageData.observations));
        const current = currentCandidates();
        if (current.candidates.length >= query.limit) break;

        const nextCursor = body.meta.cursor;
        if (typeof nextCursor !== "string" || nextCursor.length === 0) break;
        if (pagesRead >= MAX_IMPORT_PAGES || observationsRead >= MAX_IMPORT_OBSERVATIONS) {
          throw sanitizedLimitError();
        }
        if (seenCursors.has(nextCursor)) {
          limitations.push("Langfuse returned a repeated cursor; pagination stopped.");
          break;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
    } else {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const parameters = new URLSearchParams({
          page: String(page),
          limit: String(query.limit),
          fromTimestamp: query.fromStartTime,
          toTimestamp: query.toStartTime,
        });
        if (query.filter !== undefined) {
          const parameter = query.filter.field === "traceName" ? "name" : query.filter.field;
          parameters.set(parameter, query.filter.value);
        }
        const response = await this.#get(`/api/public/traces?${parameters}`);
        const body = this.#parsePage(legacyPageSchema, await this.#readJson(response));
        if (!Array.isArray(body.data)) throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
        pagesRead += 1;
        const pageData = takeObservationBudget(body.data);
        if (pageData.truncated) throw sanitizedLimitError();
        let traces: z.infer<typeof legacyTraceSchema>[];
        try {
          traces = this.#parsePage(z.array(legacyTraceSchema), pageData.observations);
        } catch {
          throw sanitizedError("LANGFUSE_CASE_IMPORT_FAILED");
        }
        addRoots(traces.map((trace) => ({
          id: trace.id,
          traceId: trace.id,
          startTime: trace.timestamp,
          isRootObservation: true,
          input: trace.input,
          sessionId: trace.sessionId,
          traceName: trace.traceName,
          name: trace.name,
        })));
        totalPages = body.meta.totalPages;
        const current = currentCandidates();
        if (current.candidates.length >= query.limit) break;
        if (page >= totalPages) break;
        if (pagesRead >= MAX_IMPORT_PAGES || observationsRead >= MAX_IMPORT_OBSERVATIONS) {
          throw sanitizedLimitError();
        }
        page += 1;
      }
    }

    const result = currentCandidates();
    return {
      candidates: result.candidates.slice(0, query.limit),
      skipped: result.skipped,
      limitations,
    };
  }
}
