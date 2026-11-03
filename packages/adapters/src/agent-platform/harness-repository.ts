import { createHash } from "node:crypto";
import type { AgentCapabilities, AgentHarnessRepository, AgentId, DomainId, HarnessSnapshot, HarnessSnapshotId } from "@harness-lab/domain";
import { z } from "zod";
import type { AgentPlatformClient } from "./client.js";
import { mapAgentCapabilities } from "./capabilities.js";

const harnessSchema = z.object({
  id: z.string(),
  version: z.string(),
  dtaFlow: z.unknown().optional(),
  tools: z.unknown().optional(),
  parameters: z.unknown().optional(),
  knowledge: z.unknown().optional(),
  memory: z.unknown().optional(),
  records: z.unknown().optional(),
  immutableRules: z.array(z.string()).default([]),
}).passthrough();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

async function jsonOrStableError(response: Response): Promise<unknown> {
  if (response.status === 401 || response.status === 403) throw new Error("AGENT_PLATFORM_INVALID_CREDENTIALS");
  if (!response.ok) throw new Error("AGENT_PLATFORM_REQUEST_FAILED");
  return response.json();
}

export class AgentPlatformHarnessRepository implements AgentHarnessRepository {
  readonly #client: AgentPlatformClient;
  readonly #now: () => string;
  readonly #snapshots = new Map<HarnessSnapshotId, HarnessSnapshot>();

  constructor(client: AgentPlatformClient, now: () => string = () => new Date().toISOString()) {
    this.#client = client;
    this.#now = now;
  }

  async getCapabilities(agentId: AgentId): Promise<AgentCapabilities> {
    const response = await this.#client.request(`/api/agents/${encodeURIComponent(agentId)}/capabilities`);
    return mapAgentCapabilities(await jsonOrStableError(response));
  }

  async fetchSnapshot(agentId: AgentId, domainId: DomainId): Promise<HarnessSnapshot> {
    const response = await this.#client.request(`/api/agents/${encodeURIComponent(agentId)}/harness`);
    const raw = await jsonOrStableError(response);
    const parsed = harnessSchema.parse(raw);
    // O hash cobre a resposta original; campos desconhecidos ficam opacos para permitir round-trip sem descartá-los.
    const canonical = JSON.stringify(raw);
    const components: Record<string, string> = {};
    const mappings = [["dta-flow", parsed.dtaFlow], ["tools", parsed.tools], ["parameters", parsed.parameters], ["knowledge", parsed.knowledge], ["memory", parsed.memory], ["records", parsed.records]] as const;
    for (const [name, value] of mappings) if (value !== undefined) components[name] = JSON.stringify(value);
    return {
      id: `${agentId}:${parsed.version}` as HarnessSnapshotId,
      agentId,
      domainId,
      version: parsed.version,
      components: Object.freeze(components),
      immutableConstraints: Object.freeze([...parsed.immutableRules]),
      createdAt: this.#now(),
      sourceVersion: parsed.version,
      artifactHash: createHash("sha256").update(canonical).digest("hex"),
      opaquePayload: deepFreeze(structuredClone(raw as Record<string, unknown>)),
    };
  }

  async getSnapshot(id: HarnessSnapshotId): Promise<HarnessSnapshot | null> {
    return this.#snapshots.get(id) ?? null;
  }

  async saveSnapshot(snapshot: HarnessSnapshot): Promise<void> {
    this.#snapshots.set(snapshot.id, deepFreeze(structuredClone(snapshot)));
  }
}