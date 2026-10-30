# Harness2 Refinement and Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt pinned Harness2 behavior to LYNN, produce evidence-linked candidates, evaluate them independently on reserved cases, and export auditable decisions.

**Architecture:** Place Harness2 behind `RefinementEngine`, preserve Propose-Probe-Compose and scoped reflection, and keep evaluation in a separate module. Refinement receives only diagnosis cases; evaluation alone receives reserved cases and applies deterministic, measured, calibrated judge, and human signals.

**Tech Stack:** TypeScript application/domain packages, pinned Harness2-compatible adapter or isolated Python bridge if required by the selected upstream commit, JSON Schema contracts, Vitest characterization tests.

---

### Task 1: Pin and characterize Harness2

**Files:**
- Create: `packages/adapters/src/harness2/adapter.ts`
- Create: `packages/adapters/src/harness2/version.ts`
- Create: `tests/characterization/harness2/*.test.ts`
- Create: `tests/characterization/fixtures/harness2-corpus.json`

- [ ] Select and record an exact upstream commit in the lockfile and `version.ts`; record license and source URL in `THIRD_PARTY_NOTICES.md`.
- [ ] Write deterministic characterization tests for proposal shape, probe order/count, consumed evidence, composition, stop criteria, and persisted lessons.
- [ ] Run tests against an empty adapter and verify failure.
- [ ] Implement the narrow adapter or JSON-line bridge without exposing upstream benchmark/task types to the core.
- [ ] Run characterization tests twice and assert identical normalized outputs.
- [ ] Commit with `git commit -m "feat: pin Harness2 refinement behavior"`.

### Task 2: Partition cases without leakage

**Files:**
- Create: `packages/application/src/cases/partition-cases.ts`
- Create: `packages/domain/src/model/partition.ts`
- Test: `packages/application/src/cases/partition-cases.test.ts`

- [ ] Test grouping by session and semantic similarity, deterministic seeded partitioning, minimum reserved size, and disjoint identifiers.
- [ ] Add a spy refinement engine and assert it can never read validation case content or identifiers.
- [ ] Implement partition manifests stored before refinement starts and immutable after execution begins.
- [ ] Verify that learning persistence rejects evidence originating from reserved cases.
- [ ] Commit with `git commit -m "feat: isolate reserved validation cases"`.

### Task 3: Diagnose trace evidence

**Files:**
- Create: `packages/application/src/diagnosis/diagnose-executions.ts`
- Create: `packages/application/src/diagnosis/taxonomy.ts`
- Test: `packages/application/src/diagnosis/diagnose-executions.test.ts`

- [ ] Test rule violations, missing/unnecessary tools, invalid parameters, unsupported answers, context failures, repetition, cost, latency, infrastructure failures, and tool failures.
- [ ] Assert every finding separates observed fact and causal hypothesis and includes denominator, impact, confidence, source identifiers, sanitized excerpt, and limitations.
- [ ] Assert infrastructure/auth/tool outages do not automatically propose prompt changes.
- [ ] Implement deterministic detectors first and a bounded optional model-assisted classifier returning typed findings.
- [ ] Commit with `git commit -m "feat: diagnose agent traces with evidence"`.

### Task 4: Propose, probe, compose, and reflect

**Files:**
- Create: `packages/application/src/refinement/run-refinement.ts`
- Create: `packages/application/src/refinement/change-policy.ts`
- Create: `packages/adapters/src/harness2/lynn-mapper.ts`
- Test: `packages/application/src/refinement/run-refinement.test.ts`

- [ ] Test small independent proposals, immutable-rule protection, supported component enforcement, equivalent probe conditions, incompatible change rejection, stopping limits, and scoped lessons.
- [ ] Run focused tests and verify failure.
- [ ] Implement the chain `finding -> evidence -> hypothesis -> proposal -> execution result` as required identifiers, not free text alone.
- [ ] Probe baseline and candidates through `CandidateExecutor`; compose only compatible evidence-supported changes.
- [ ] Persist adopted and rejected lessons scoped by agent/domain and exclude reserved cases.
- [ ] Commit with `git commit -m "feat: refine LYNN harnesses with Harness2"`.

### Task 5: Build independent evaluation

**Files:**
- Create: `packages/application/src/evaluation/evaluate-candidate.ts`
- Create: `packages/application/src/evaluation/recommendation-policy.ts`
- Create: `packages/domain/src/model/evaluator.ts`
- Test: `packages/application/src/evaluation/evaluate-candidate.test.ts`

- [ ] Test deterministic format/rule/tool checks, measured completion/cost/token/latency signals, optional calibrated judge scores, and human review.
- [ ] Test that a critical failure always blocks recommendation, even with a high aggregate score.
- [ ] Test every terminal decision: recommended, rejected, inconclusive, pending validation, insufficient validation, stopped by limit, cancelled, and integration failed.
- [ ] Implement threshold policy with sample-size checks, per-case regressions, run variability, uncertainty, and versioned evaluator definitions.
- [ ] Ensure evaluation imports no Harness2 implementation modules.
- [ ] Commit with `git commit -m "feat: evaluate candidates independently"`.

### Task 6: Export candidates and audit reports

**Files:**
- Create: `packages/adapters/src/export/lynn-candidate-exporter.ts`
- Create: `packages/adapters/src/export/report-exporter.ts`
- Test: `packages/adapters/src/export/exporters.test.ts`

- [ ] Test complete LYNN artifact round-trip, unknown-field preservation, plain-language and technical diffs, report localization, content hashes, and secret redaction.
- [ ] Store exports under `APP_DATA_DIR/exports/<agent>/<round>/` and persist path, media type, hash, and source versions.
- [ ] Include decision, confidence, sample, constraints, regressions, costs, limitations, and the complete evidence chain.
- [ ] Prevent an export endpoint from publishing or promoting a candidate.
- [ ] Commit with `git commit -m "feat: export auditable LYNN candidates"`.

### Task 7: Orchestrate a complete real round

**Files:**
- Modify: `packages/application/src/rounds/process-round.ts`
- Create: `tests/integration/complete-round.test.ts`
- Create: `tests/integration/real/complete-round.smoke.test.ts`

- [ ] Write a hermetic test running collection, partition, diagnosis, refinement, LYNN execution, evaluation, decision, learning, and export through fake adapters.
- [ ] Assert cancellation, budget stop, missing trace, failed evaluator, critical regression, and resume at every checkpoint.
- [ ] Implement stage orchestration with real counters and exact refinement/Harness2/evaluator versions.
- [ ] Add a one-case opt-in real smoke that cannot target a production environment and never claims improvement when validation is insufficient.
- [ ] Commit with `git commit -m "feat: run evidence-based improvement rounds"`.

## Refinement Exit Gate

- [ ] Characterization corpus passes twice with deterministic normalized results.
- [ ] Reserved-case leakage tests pass.
- [ ] Complete hermetic round produces a candidate, evidence chain, decision, and export.
- [ ] Real bounded round reports either evidence-based validation or an explicit blocker.
