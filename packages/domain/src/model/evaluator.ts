export interface EvaluatorDefinition {
  readonly id: string;
  readonly version: string;
  readonly minimumSampleSize: number;
  readonly recommendationThreshold: number;
  readonly maximumRegressionRate: number;
}