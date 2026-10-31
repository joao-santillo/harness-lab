# Agent Platform and Langfuse Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the foundation to real Agent Platform and Langfuse APIs with capability negotiation, safe trace collection, candidate execution, and tested compatibility fallbacks.

**Architecture:** Keep generated or hand-authored HTTP clients private to adapter modules. Translate all external payloads into domain types, persist detected capabilities per connection, and use sanitized contract fixtures plus opt-in real smoke tests.

**Tech Stack:** TypeScript, Fastify HTTP client, Zod, Vitest, MSW/WireMock-style local fake servers, Drizzle SQLite.

---

### Task 1: Snapshot sanitized external contracts

**Files:**
- Create: `tests/contract/fixtures/agent-platform-openapi.sanitized.json`
- Create: `tests/contract/fixtures/langfuse-openapi.sanitized.json`
- Create: `tests/contract/external-contracts.test.ts`
- Create: `scripts/refresh-contract-snapshots.ts`

- [ ] Write a failing contract test asserting every operation and schema used by the application exists with compatible required fields.
- [ ] Run `pnpm vitest tests/contract/external-contracts.test.ts`; expect missing fixtures or operations.
- [ ] Implement a refresh script that reads authenticated schemas, strips servers, examples, credentials, and sensitive extensions, then writes deterministic sorted JSON.
- [ ] Assert Agent Platform version CRUD/execution, job/status, parameters, artifacts, memory, and workflow schemas; assert Langfuse traces, observations, scores, pagination, and error schemas.
- [ ] Run the test and inspect `git diff` for sanitized output only.
- [ ] Commit with `git commit -m "test: pin sanitized integration contracts"`.

### Task 2: Implement Langfuse capability negotiation

**Files:**
- Create: `packages/adapters/src/langfuse/client.ts`
- Create: `packages/adapters/src/langfuse/capabilities.ts`
- Test: `packages/adapters/src/langfuse/capabilities.test.ts`

- [ ] Test a working Observations v2 instance, an advertised-v2-but-404 instance, a legacy-only instance, invalid credentials, and rate limiting.
- [ ] Run the focused test and verify it fails.
- [ ] Implement bounded probes that never log credentials and persist `observationsApi`, `scoresApi`, supported filters, and probe timestamp.
- [ ] Prefer Observations v2 when a real bounded read succeeds; otherwise select the legacy trace path and record the mismatch limitation.
- [ ] Verify with `pnpm --filter @harness-lab/adapters test -- langfuse`.
- [ ] Commit with `git commit -m "feat: negotiate Langfuse capabilities"`.

### Task 3: Collect and normalize Langfuse traces

**Files:**
- Create: `packages/adapters/src/langfuse/trace-repository.ts`
- Create: `packages/adapters/src/langfuse/normalize.ts`
- Create: `packages/application/src/traces/collect-traces.ts`
- Test: `packages/adapters/src/langfuse/trace-repository.test.ts`
- Test: `packages/adapters/src/langfuse/normalize.test.ts`

- [ ] Test cursor and page pagination, time-window narrowing, retry-after handling, checkpoint resume, duplicate observations, missing parents, multiple roots, absent metrics, and legacy fallback.
- [ ] Run focused tests and verify failure.
- [ ] Implement bounded collection with deduplication by project/observation identifier and persisted source API metadata.
- [ ] Reconstruct physical parent trees, logical roots, inputs, outputs, tools, errors, model data, tokens, cost, latency, session, environment, version, and explicit missing-field markers.
- [ ] Treat all trace text as untrusted data and never interpolate it into privileged instructions.
- [ ] Verify and commit with `git commit -m "feat: collect normalized Langfuse evidence"`.

### Task 4: Implement Agent Platform capability discovery and harness snapshots

**Files:**
- Create: `packages/adapters/src/agent-platform/client.ts`
- Create: `packages/adapters/src/agent-platform/capabilities.ts`
- Create: `packages/adapters/src/agent-platform/harness-repository.ts`
- Test: `packages/adapters/src/agent-platform/harness-repository.test.ts`

- [ ] Test authenticated discovery, editable component mapping, unsupported components, unknown new fields, immutable snapshot creation, and sanitized API failures.
- [ ] Run focused tests and verify failure.
- [ ] Map only proven `dta-flow`, tools, parameters, knowledge references, memory, and records into internal editable components.
- [ ] Preserve unrecognized Agent Platform fields in opaque round-trip payloads so candidate export does not destroy them.
- [ ] Record source version, artifact hashes, and detected capabilities in every snapshot.
- [ ] Verify and commit with `git commit -m "feat: inspect Agent Platform harness capabilities"`.

### Task 5: Execute baseline and candidate versions on Agent Platform

**Files:**
- Create: `packages/adapters/src/agent-platform/candidate-executor.ts`
- Create: `packages/application/src/execution/execute-case.ts`
- Test: `packages/adapters/src/agent-platform/candidate-executor.test.ts`

- [ ] Test synchronous execution, asynchronous jobs, timeout, cancellation, idempotent retry, version failure, trace correlation, and a completed Agent Platform execution whose Langfuse trace never arrives.
- [ ] Run focused tests and verify failure.
- [ ] Create candidate versions without publishing them; pass model parameters, tool conditions, correlation identifiers, and safe test-environment constraints.
- [ ] Poll bounded job/status endpoints and return separate `execution_failed`, `trace_pending`, and `completed` outcomes.
- [ ] Verify and commit with `git commit -m "feat: execute Agent Platform harness candidates"`.

### Task 6: Generate baseline traces from reviewed cases

**Files:**
- Create: `packages/application/src/cases/import-cases.ts`
- Create: `packages/application/src/traces/generate-baseline.ts`
- Create: `apps/api/src/routes/cases.ts`
- Test: `packages/application/src/traces/generate-baseline.test.ts`

- [ ] Test manual, CSV, JSON, historical, and synthetic-labelled cases; reject malformed input and disallowed tool environments.
- [ ] Test bounded waiting for correlated Langfuse traces and `validation_insufficient` when independent reserved cases are too few.
- [ ] Implement idempotency per round/case/baseline version and explicit collection-incomplete outcomes.
- [ ] Expose review/import APIs that never label synthetic cases as real.
- [ ] Verify and commit with `git commit -m "feat: generate trace baselines safely"`.

### Task 7: Add integration screens and real smoke tests

**Files:**
- Create: `apps/web/src/features/agents/agent-wizard.tsx`
- Create: `apps/web/src/features/cases/case-review.tsx`
- Create: `tests/integration/real/agent-platform-langfuse.smoke.test.ts`
- Test: `apps/web/src/features/agents/agent-wizard.test.tsx`

- [ ] Test guided Agent Platform/Langfuse setup, capability display, unsupported controls, baseline selection, immutable rules, case import, and partition counts.
- [ ] Implement the wizard and case review using versioned API clients.
- [ ] Add an opt-in smoke test guarded by `RUN_REAL_INTEGRATION=1`, strict one-case limits, test-environment validation, and sanitized output.
- [ ] Run hermetic tests always; run the real smoke only when credentials and explicit opt-in are present.
- [ ] Commit with `git commit -m "feat: complete integration setup flow"`.

## Integration Exit Gate

- [ ] Hermetic contract and integration suites pass for modern and fallback Langfuse paths.
- [ ] A bounded opt-in test creates and executes a non-production Agent Platform candidate and correlates its Langfuse trace.
- [ ] Secrets do not appear in snapshots, logs, errors, or test reports.
