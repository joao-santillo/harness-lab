import type { LangfuseClient } from "./client.js";
import { z } from "zod";

const legacyProbeSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ page: z.number(), totalPages: z.number() }).passthrough(),
});

export interface LangfuseCapabilities {
  readonly observationsApi: "v2" | "legacy";
  readonly scoresApi: "v3";
  readonly supportedFilters: readonly string[];
  readonly probedAt: string;
  readonly limitations: readonly string[];
}

export async function negotiateLangfuseCapabilities(
  client: LangfuseClient,
  now: () => string = () => new Date().toISOString(),
): Promise<LangfuseCapabilities> {
  const response = await client.get("/api/public/v2/observations?limit=1");
  if (response.status === 401 || response.status === 403) throw new Error("LANGFUSE_INVALID_CREDENTIALS");
  if (response.status === 429) throw new Error("LANGFUSE_RATE_LIMITED");
  if (response.ok) {
    return {
      observationsApi: "v2",
      scoresApi: "v3",
      supportedFilters: ["fromStartTime", "toStartTime", "traceId", "type", "environment"],
      probedAt: now(),
      limitations: [],
    };
  }
  if (response.status === 404 || response.status === 405) {
    // Há instâncias que anunciam v2, mas não a servem; o fallback fica explícito e carrega a limitação para auditoria.
    const probedAt = now();
    const toTimestamp = new Date(probedAt);
    if (Number.isNaN(toTimestamp.getTime())) throw new Error("LANGFUSE_CAPABILITY_PROBE_FAILED");
    const fromTimestamp = new Date(toTimestamp.getTime() - 60_000).toISOString();
    const legacyParameters = new URLSearchParams({ page: "1", limit: "1", fromTimestamp, toTimestamp: toTimestamp.toISOString() });
    const legacyResponse = await client.get(`/api/public/traces?${legacyParameters}`);
    if (legacyResponse.status === 401 || legacyResponse.status === 403) throw new Error("LANGFUSE_INVALID_CREDENTIALS");
    if (legacyResponse.status === 429) throw new Error("LANGFUSE_RATE_LIMITED");
    if (!legacyResponse.ok) throw new Error("LANGFUSE_CAPABILITY_PROBE_FAILED");
    legacyProbeSchema.parse(await legacyResponse.json());
    return {
      observationsApi: "legacy",
      scoresApi: "v3",
      supportedFilters: ["fromTimestamp", "toTimestamp"],
      probedAt,
      limitations: [response.status === 404
        ? "Observations v2 probe returned 404; using deprecated legacy trace reads."
        : "Observations v2 is unavailable; using deprecated legacy trace reads."],
    };
  }
  throw new Error("LANGFUSE_CAPABILITY_PROBE_FAILED");
}