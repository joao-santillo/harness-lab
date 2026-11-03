import { createHash } from "node:crypto";
import type { PartitionCase, PartitionManifest, PartitionOptions } from "@harness-lab/domain";

function stableRank(seed: string, ids: readonly string[]): string {
  return createHash("sha256").update(`${seed}\0${ids.join("\0")}`).digest("hex");
}

function groupedCases(cases: readonly PartitionCase[]): PartitionCase[][] {
  const remaining = new Map(cases.map((item) => [item.id, item]));
  const groups: PartitionCase[][] = [];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as PartitionCase;
    const group = [first];
    remaining.delete(first.id);
    // O vínculo é transitivo: se A compartilha sessão com B e B pertence ao mesmo grupo semântico de C, os três ficam juntos.
    // Isso evita que variantes correlacionadas apareçam dos dois lados da validação.
    for (let index = 0; index < group.length; index += 1) {
      const current = group[index]!;
      for (const candidate of [...remaining.values()]) {
        if (candidate.sessionId === current.sessionId || candidate.similarityGroup === current.similarityGroup) {
          group.push(candidate);
          remaining.delete(candidate.id);
        }
      }
    }
    groups.push(group.sort((left, right) => left.id.localeCompare(right.id)));
  }
  return groups;
}

export function partitionCases(cases: readonly PartitionCase[], options: PartitionOptions): PartitionManifest {
  if (cases.length < 2) throw new Error("PARTITION_REQUIRES_MULTIPLE_CASES");
  if (options.minimumReserved < 1 || options.minimumReserved >= cases.length) throw new Error("RESERVED_SIZE_INVALID");
  if (options.reservedRatio <= 0 || options.reservedRatio >= 1) throw new Error("RESERVED_RATIO_INVALID");
  if (new Set(cases.map(({ id }) => id)).size !== cases.length) throw new Error("CASE_ID_DUPLICATE");

  const target = Math.max(options.minimumReserved, Math.ceil(cases.length * options.reservedRatio));
  const groups = groupedCases(cases).sort((left, right) =>
    stableRank(options.seed, left.map(({ id }) => id)).localeCompare(stableRank(options.seed, right.map(({ id }) => id))),
  );
  const reserved = new Set<string>();
  for (const group of groups) {
    if (reserved.size >= target) break;
    // Nunca reservamos o último grupo inteiro: o refinamento precisa manter ao menos um caso de diagnóstico.
    if (reserved.size + group.length < cases.length) group.forEach(({ id }) => reserved.add(id));
  }
  if (reserved.size < options.minimumReserved) throw new Error("RESERVED_SIZE_UNSATISFIABLE");

  const allIds = cases.map(({ id }) => id).sort();
  return {
    version: 1,
    seed: options.seed,
    diagnosisIds: allIds.filter((id) => !reserved.has(id)),
    reservedIds: allIds.filter((id) => reserved.has(id)),
    createdAt: options.createdAt ?? "1970-01-01T00:00:00.000Z",
  };
}

export function sealPartitionManifest(manifest: PartitionManifest): PartitionManifest {
  return Object.freeze({
    ...manifest,
    diagnosisIds: Object.freeze([...manifest.diagnosisIds]),
    reservedIds: Object.freeze([...manifest.reservedIds]),
  });
}

export async function runRefinementWithDiagnosisCases<Result>(
  cases: readonly PartitionCase[],
  manifest: PartitionManifest,
  refine: (cases: readonly Pick<PartitionCase, "id" | "content">[]) => Promise<Result>,
): Promise<Result> {
  // A projeção remove deliberadamente sessionId/grupo e todo o conteúdo reservado antes de chamar o engine.
  const diagnosisIds = new Set(manifest.diagnosisIds);
  const visibleCases = cases
    .filter(({ id }) => diagnosisIds.has(id))
    .map(({ id, content }) => Object.freeze({ id, content }));
  return refine(Object.freeze(visibleCases));
}

export function assertLearningSources(manifest: PartitionManifest, sourceCaseIds: readonly string[]): void {
  // Aprendizados podem influenciar rodadas futuras; aceitar validação aqui criaria vazamento indireto.
  const diagnosisIds = new Set(manifest.diagnosisIds);
  if (sourceCaseIds.some((id) => !diagnosisIds.has(id))) throw new Error("RESERVED_CASE_EVIDENCE_FORBIDDEN");
}