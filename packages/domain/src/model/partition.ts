export interface PartitionCase {
  readonly id: string;
  readonly sessionId: string;
  readonly similarityGroup: string;
  readonly content: string;
}

export interface PartitionManifest {
  readonly version: 1;
  readonly seed: string;
  readonly diagnosisIds: readonly string[];
  readonly reservedIds: readonly string[];
  readonly createdAt: string;
}

export interface PartitionOptions {
  readonly seed: string;
  readonly minimumReserved: number;
  readonly reservedRatio: number;
  readonly createdAt?: string;
}