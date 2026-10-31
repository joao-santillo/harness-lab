# Agent Platform Harness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable monorepo, stable domain contracts, encrypted local persistence, localized API, and durable round lifecycle that later plans extend.

**Architecture:** Use a TypeScript monorepo with a dependency-free domain package, application use cases, Fastify API, background worker, React frontend, and adapter packages. SQLite is accessed through Drizzle; application code depends on ports, while composition roots select adapters.

**Tech Stack:** Node.js 22, pnpm workspaces, TypeScript, Fastify, React 19, Vite, Drizzle ORM, better-sqlite3, Zod, Vitest, Playwright, Pino, libsodium-wrappers.

---

## File Map

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`: workspace commands and shared compiler policy.
- `packages/domain/src/*`: language-neutral entities, value objects, ports, and round state machine.
- `packages/application/src/*`: use cases and orchestration independent from frameworks.
- `packages/adapters/src/sqlite/*`: schema, migrations, repositories, and encrypted secret storage.
- `apps/api/src/*`: HTTP composition root, validation, localization, and SSE endpoints.
- `apps/worker/src/*`: durable job polling and round execution.
- `apps/web/src/*`: initial localized shell and connection/round screens.
- `tests/contract/*`, `tests/e2e/*`: external contract and browser boundaries.

### Task 1: Bootstrap the workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/src/index.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index.js";

describe("domain package", () => {
  it("exports the product identity", () => {
    expect(APP_NAME).toBe("Agent Platform Harness Improvement");
  });
});
```

- [ ] **Step 2: Add workspace manifests and scripts**

Use `package.json` scripts `build`, `typecheck`, `test`, `lint`, `dev`, and `test:e2e`; require Node 22 and pnpm 10. Add exact versions for TypeScript, Vitest, ESLint, Prettier, Fastify, React, Vite, Drizzle, better-sqlite3, Zod, Pino, Playwright, and libsodium-wrappers. Put only variable names and safe defaults in `.env.example`: `APP_DATA_DIR`, `APP_ENCRYPTION_KEY`, `APP_LOCALE`, `API_PORT`, and `WEB_PORT`.

- [ ] **Step 3: Run the test and verify the missing export**

Run: `pnpm install --frozen-lockfile=false && pnpm --filter @harness-lab/domain test`

Expected: FAIL because `APP_NAME` is not exported.

- [ ] **Step 4: Add the minimal export**

```ts
export const APP_NAME = "Agent Platform Harness Improvement";
```

- [ ] **Step 5: Verify the workspace**

Run: `pnpm --filter @harness-lab/domain test && pnpm typecheck`

Expected: all tests and type checking pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .env.example packages/domain
git commit -m "build: bootstrap Agent Platform harness workspace"
```

### Task 2: Define domain contracts and states

**Files:**
- Create: `packages/domain/src/model/round.ts`
- Create: `packages/domain/src/model/evidence.ts`
- Create: `packages/domain/src/model/harness.ts`
- Create: `packages/domain/src/model/evaluation.ts`
- Create: `packages/domain/src/ports/index.ts`
- Test: `packages/domain/src/model/round.test.ts`

- [ ] **Step 1: Write state-transition tests**

```ts
import { describe, expect, it } from "vitest";
import { transitionRound } from "./round.js";

describe("transitionRound", () => {
  it("allows setup to collection", () => {
    expect(transitionRound("setup", "collection_started")).toBe("collecting");
  });

  it("rejects evaluation before collection", () => {
    expect(() => transitionRound("setup", "evaluation_started")).toThrow("Invalid round transition");
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @harness-lab/domain test -- round.test.ts`

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement immutable types and ports**

Define branded identifiers, `RoundState`, terminal decisions, `Evidence`, `Finding`, `Hypothesis`, `HarnessSnapshot`, `Candidate`, `ExecutionResult`, `EvaluationResult`, and typed ports: `TraceRepository`, `AgentHarnessRepository`, `CandidateExecutor`, `RefinementEngine`, `EvaluationEngine`, `RunRepository`, `SecretStore`, `ArtifactExporter`, and `EventPublisher`. Define transition tables explicitly and return new values rather than mutating entities.

- [ ] **Step 4: Export the contracts and verify**

Run: `pnpm --filter @harness-lab/domain test && pnpm typecheck`

Expected: PASS with invalid transitions rejected.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat: define harness domain contracts"
```

### Task 3: Add SQLite persistence and migrations

**Files:**
- Create: `packages/adapters/package.json`
- Create: `packages/adapters/src/sqlite/schema.ts`
- Create: `packages/adapters/src/sqlite/client.ts`
- Create: `packages/adapters/src/sqlite/run-repository.ts`
- Create: `packages/adapters/src/sqlite/migrations/0001_foundation.sql`
- Test: `packages/adapters/src/sqlite/run-repository.test.ts`

- [ ] **Step 1: Write a repository round-trip test**

Create a temporary database, migrate it, save one agent, one immutable harness snapshot, one round, and two ordered events, then reopen the database and assert all values and event order survive.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @harness-lab/adapters test -- run-repository.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the schema and repository**

Create normalized tables for agents, connections, capabilities, harness versions, rounds, events, checkpoints, cases, partitions, executions, findings, proposals, evaluations, learnings, and exports. Enforce foreign keys, immutable harness version rows, unique event sequence per round, and unique execution idempotency keys.

- [ ] **Step 4: Verify migration and persistence**

Run: `pnpm --filter @harness-lab/adapters test && pnpm typecheck`

Expected: PASS against a fresh and reopened SQLite database.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters
git commit -m "feat: persist rounds and evidence in SQLite"
```

### Task 4: Encrypt integration credentials

**Files:**
- Create: `packages/adapters/src/security/encrypted-secret-store.ts`
- Create: `packages/adapters/src/security/redactor.ts`
- Test: `packages/adapters/src/security/encrypted-secret-store.test.ts`
- Test: `packages/adapters/src/security/redactor.test.ts`

- [ ] **Step 1: Write encryption and redaction tests**

Assert that saved ciphertext contains neither public nor secret keys, decrypts only with the configured master key, fails with another key, can be replaced/deleted, and redacts authorization headers, known keys, and URLs containing credentials.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @harness-lab/adapters test -- security`

Expected: FAIL because security adapters do not exist.

- [ ] **Step 3: Implement sealed secret storage**

Use libsodium `crypto_secretbox_easy` with a random nonce and a 32-byte key decoded from `APP_ENCRYPTION_KEY`. Store `key_version`, nonce, and ciphertext. Return only secret identifiers and configured state outside the adapter.

- [ ] **Step 4: Implement structured redaction**

Recursively redact keys matching `authorization`, `token`, `secret`, `password`, `apiKey`, and configured secret values before logging or exporting. Preserve stable error codes.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @harness-lab/adapters test && pnpm typecheck`

```bash
git add packages/adapters/src/security
git commit -m "feat: encrypt and redact integration secrets"
```

### Task 5: Build localized Fastify API

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/connections.ts`
- Create: `apps/api/src/routes/agents.ts`
- Create: `apps/api/src/routes/rounds.ts`
- Create: `apps/api/src/i18n.ts`
- Create: `packages/application/src/connections/register-connection.ts`
- Test: `apps/api/src/routes/connections.test.ts`

- [ ] **Step 1: Write API contract tests**

Test `POST /api/v1/connections`, `GET /api/v1/connections/:id`, and `DELETE /api/v1/connections/:id`. Assert Zod validation, idempotency behavior, localized errors for `pt-BR`, `en`, and `es`, and that plaintext credentials never appear in responses.

- [ ] **Step 2: Run the route test**

Run: `pnpm --filter @harness-lab/api test -- connections.test.ts`

Expected: FAIL because the API is absent.

- [ ] **Step 3: Implement use case and routes**

Create request/response schemas and a `RegisterConnection` use case depending only on `SecretStore` and a typed connection tester. Store stable message codes and render localized text at the HTTP boundary.

- [ ] **Step 4: Add agent and round resource skeletons**

Expose versioned JSON contracts for agents, rounds, credentials status, and events. Do not serialize database rows directly.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @harness-lab/api test && pnpm typecheck`

```bash
git add apps/api packages/application
git commit -m "feat: expose localized foundation API"
```

### Task 6: Add durable worker and SSE progress

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/worker.ts`
- Create: `packages/application/src/rounds/start-round.ts`
- Create: `packages/application/src/rounds/process-round.ts`
- Create: `apps/api/src/routes/events.ts`
- Test: `apps/worker/src/worker.test.ts`
- Test: `apps/api/src/routes/events.test.ts`

- [ ] **Step 1: Write checkpoint and replay tests**

Assert that a queued round is claimed once, every stage persists a checkpoint and ordered event, cancellation is cooperative, restart resumes after the last checkpoint, and SSE replays events after `Last-Event-ID`.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @harness-lab/worker test && pnpm --filter @harness-lab/api test -- events.test.ts`

Expected: FAIL because worker and event stream are absent.

- [ ] **Step 3: Implement polling and stage orchestration**

Use transactional compare-and-set claiming in SQLite. Process only explicit stages, persist real counters and consumed limits, and mark recoverable versus terminal failures with stable codes.

- [ ] **Step 4: Implement SSE replay**

Read persisted events after the requested sequence, emit them in order, then subscribe to new committed events. Send heartbeats without inventing progress.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/worker apps/api/src/routes/events.ts packages/application/src/rounds
git commit -m "feat: process durable rounds with SSE progress"
```

### Task 7: Add the initial web shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/i18n/*`
- Create: `apps/web/src/features/connections/*`
- Create: `apps/web/src/features/rounds/*`
- Test: `apps/web/src/app.test.tsx`

- [ ] **Step 1: Write interface tests**

Test keyboard navigation among Agents, Rounds, and Results; locale switching; masked credential fields; connection form validation; empty rounds state; and reconnecting to an active SSE stream.

- [ ] **Step 2: Run the web test**

Run: `pnpm --filter @harness-lab/web test`

Expected: FAIL because the web app is absent.

- [ ] **Step 3: Implement the responsive application shell**

Use accessible semantic navigation, restrained operational styling, real loading/error/empty states, and locale files containing stable keys in all three languages. Do not include a marketing landing page.

- [ ] **Step 4: Verify the foundation vertically**

Run: `pnpm test && pnpm build && pnpm typecheck`

Expected: all workspace checks pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add localized operations interface"
```

## Foundation Exit Gate

- [ ] Start API, worker, and web processes locally.
- [ ] Register a fake connection without exposing its secret.
- [ ] Create, cancel, resume, and inspect a round with fake stage adapters.
- [ ] Verify SQLite persistence after all processes restart.
- [ ] Run `pnpm test && pnpm build && pnpm typecheck` successfully.
