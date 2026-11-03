# Runtime and Connection UI Wiring Plan

**Goal:** Connect the tested round pipeline to a worker runtime and persist connections submitted from the web UI, preserving evaluation decisions and secret handling.

**Architecture:** Keep `ProcessRound` as the durable lifecycle controller, with stage runners returning a terminal event only after export. Compose SQLite repositories/stores and supplied integration ports in a worker runtime factory. Keep connection credentials in form memory only, submit to the existing versioned API, and clear them after the request settles.

**Tech Stack:** TypeScript, Fastify, React, Vitest, SQLite, Playwright.

**Spec:** Follow existing domain transitions, `POST /api/v1/connections`, encrypted secret storage, and the pinned adapter contracts; do not invent Agent Platform endpoints.

## Global Constraints

- Never log or return plaintext credentials.
- Preserve worker leases, cancellation checks, and checkpoint ordering.
- Never force a recommendation when evaluator decision differs.
- Do not claim real Agent Platform compatibility beyond hermetic contract fixtures.

## Review Focus

- Any terminal decision other than `recommended` must survive export and persistence.
- A restarted worker must load the same persisted artifact session as the stage runner.
- Agent Platform token fields must not be submitted as Langfuse keys.
- API failures, duplicate IDs, and missing network access must not display success or retain secrets.
- Existing API consumers and all three locales must remain compatible.

---

### Task 1: Preserve terminal evaluation decisions

**Files:** `packages/application/src/rounds/process-round.ts`, its tests, `packages/application/src/rounds/create-round-stages.ts`, its tests.

**Interfaces:** A stage runner may return a `RoundEvent`; the export runner returns the event corresponding to the persisted evaluation decision. The controller commits `export_started` before the returned terminal event.

- [x] Add failing tests for rejected and inconclusive outcomes.
- [x] Run focused tests and verify the current controller incorrectly recommends.
- [x] Implement the minimal runner result and decision mapping.
- [x] Run application tests and typecheck.

### Task 2: Compose the durable worker runtime

**Files:** `apps/worker/src/runtime.ts`, its tests, `packages/application/src/rounds/create-round-stages.ts` exported dependency types, worker exports.

**Interfaces:** `createRoundWorkerRuntime(options)` wires SQLite run repository, job store, artifact store, `createRoundStages`, `ProcessRound`, and `DurableRoundWorker`; caller supplies case, trace, harness, proposal, executor, evaluator, export ports and worker options.

- [x] Add a failing test that enqueues a round, ticks the composed runtime, and verifies persisted terminal state/session and export callback.
- [x] Implement dependency-injected runtime composition without guessing external data sources.
- [x] Verify runtime tests, worker tests, and package typechecks.

### Task 3: Submit connections from the web UI

**Files:** `apps/web/src/features/connections/connection-form.tsx`, `apps/web/src/i18n/messages.ts`, UI tests and E2E.

**Interfaces:** Use `POST /api/v1/connections` with an idempotency key and credential fields appropriate to selected integration; default fetch is same-origin `/api/v1`. Clear secret inputs after submit and localize saved/auth/unavailable/conflict states.

- [x] Add failing UI tests for request payloads, errors, and secret clearing.
- [x] Implement the async form and dynamic fields for Langfuse vs Agent Platform.
- [x] Verify localized unit tests, Playwright E2E, web typecheck/build, then full workspace gates.

### Task 4: First-party agent and case intake

**Files:** `packages/domain/src/model/case.ts`, `packages/adapters/src/sqlite/case-repository.ts`, `apps/api/src/routes/agents.ts`, `apps/api/src/routes/cases.ts`, `apps/web/src/features/cases/agent-case-form.tsx`.

- [x] Add failing tests for scoped atomic storage and UI/API intake.
- [x] Implement agent catalog and bounded JSON import/list endpoints.
- [x] Use the SQLite case repository as the worker's default case source.
- [x] Verify desktop/mobile E2E, package tests, and typechecks.

### Task 5: Executable service entrypoints

**Files:** API/worker `config.ts` and `main.ts`, package `start` scripts, `.env.example`, `README.md`.

- [x] Add tests for key, path, port, polling, and provider module configuration.
- [x] Add API server startup and a leased worker polling loop with graceful close.
- [x] Require a local provider module; fail safely when it is absent or invalid.
- [x] Smoke-test startup guards using intentionally invalid local placeholders.

## Explicitly Deferred

- API and worker entrypoints are implemented. The worker process safely requires a local provider module; a deployment-specific module remains deferred until the trace source, proposal policy, export secrets, and Agent Platform connection-test contract are supplied.
- Agent catalog, JSON and RFC4180 CSV case intake, historical source references, synthetic labels, and the default SQLite case source are implemented. Trace-to-case association, trace time-window policy, and proposal generation remain deferred until their evidence/strategy contracts are provided.
- Round creation/listing/cancellation and persisted evaluation summaries are connected to the web UI. API routes remain unauthenticated and must stay loopback-only or sit behind an authenticated reverse proxy.
