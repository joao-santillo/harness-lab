import { z } from "zod";

const observationSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  parentObservationId: z.string().nullable().optional(),
  type: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  startTime: z.string(),
  endTime: z.string().nullable().optional(),
  usageDetails: z.record(z.string(), z.number()).nullable().optional(),
  costDetails: z.record(z.string(), z.number()).nullable().optional(),
  metadata: z.unknown().optional(),
});

export type RawObservation = z.infer<typeof observationSchema>;

export interface NormalizedObservation {
  readonly projectId: string;
  readonly id: string;
  readonly traceId: string;
  readonly parentId: string | null;
  readonly type: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly latencyMs: number | null;
  readonly usage: Readonly<Record<string, number>> | null;
  readonly cost: Readonly<Record<string, number>> | null;
  readonly sourceApi: "observations-v2";
}

export function normalizeObservations(projectId: string, input: readonly unknown[]): {
  observations: readonly NormalizedObservation[];
  logicalRootIds: readonly string[];
  limitations: readonly string[];
} {
  const unique = new Map<string, RawObservation>();
  for (const item of input) {
    const observation = observationSchema.parse(item);
    unique.set(`${projectId}:${observation.id}`, observation);
  }
  const ids = new Set([...unique.values()].map(({ id }) => id));
  const limitations: string[] = [];
  const roots: string[] = [];
  const observations = [...unique.values()].map((observation) => {
    const parentId = observation.parentObservationId ?? null;
    if (parentId === null || !ids.has(parentId)) roots.push(observation.id);
    if (parentId !== null && !ids.has(parentId)) limitations.push(`Observation ${observation.id} references missing parent ${parentId}.`);
    if (!observation.usageDetails || !observation.costDetails) limitations.push(`Observation ${observation.id} has missing usage or cost metrics.`);
    const latencyMs = observation.endTime === null || observation.endTime === undefined
      ? null
      : new Date(observation.endTime).getTime() - new Date(observation.startTime).getTime();
    return {
      projectId,
      id: observation.id,
      traceId: observation.traceId,
      parentId,
      type: observation.type,
      input: observation.input ?? null,
      output: observation.output ?? null,
      startTime: observation.startTime,
      endTime: observation.endTime ?? null,
      latencyMs,
      usage: observation.usageDetails ?? null,
      cost: observation.costDetails ?? null,
      sourceApi: "observations-v2" as const,
    };
  });
  const rootsByTrace = new Map<string, number>();
  for (const observation of observations.filter(({ id }) => roots.includes(id))) {
    rootsByTrace.set(observation.traceId, (rootsByTrace.get(observation.traceId) ?? 0) + 1);
  }
  for (const [traceId, count] of rootsByTrace) if (count > 1) limitations.push(`Trace ${traceId} has multiple logical roots.`);
  return { observations, logicalRootIds: roots, limitations };
}