import type { AgentCapabilities } from "@harness-lab/domain";
import { z } from "zod";

const editableComponents = ["dta-flow", "tools", "parameters", "knowledge", "memory", "records"] as const;
const capabilitiesSchema = z.object({
  editable: z.array(z.string()),
  supportsSeed: z.boolean().default(false),
  supportsToolReplay: z.boolean().default(false),
  apiVersion: z.string(),
}).passthrough();

export interface DiscoveredAgentCapabilities extends AgentCapabilities {
  readonly apiVersion: string;
}

export function mapAgentCapabilities(input: unknown): DiscoveredAgentCapabilities {
  const parsed = capabilitiesSchema.parse(input);
  return {
    editableComponents: editableComponents.filter((component) => parsed.editable.includes(component)),
    supportsSeed: parsed.supportsSeed,
    supportsToolReplay: parsed.supportsToolReplay,
    apiVersion: parsed.apiVersion,
  };
}