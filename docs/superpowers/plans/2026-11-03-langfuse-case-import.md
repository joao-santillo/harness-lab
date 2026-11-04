# Langfuse Case Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import up to 40 historical Langfuse traces as scoped evaluation cases, safely and idempotently, through a bounded API and the existing case-intake UI.

**Architecture:** Add a dedicated Langfuse case-source adapter rather than changing the trace/evidence repository used by rounds. The API validates the agent/domain and saved connection, decrypts credentials server-side, negotiates Langfuse capabilities, maps and deduplicates candidates, then atomically persists only new cases. The UI reuses the saved-connections endpoint and existing JSON/CSV paths, adding a separate Langfuse import mode with localized status and count reporting.

**Tech Stack:** Node.js 24, TypeScript, Fastify, Zod, React, SQLite, Vitest, Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-03-langfuse-case-import-design.md`.

---

## Guardrails and file map

- Preserve the existing modified connection-list files in the worktree; do not reset, stage, or reformat them as part of this feature.
- Never return/log credentials, raw trace payloads, input contents, or outputs. Case `content` intentionally stores the selected trace input, but API responses only return counts and request bounds.
- Keep TLS validation enabled. Use `LangfuseClient` and the API's existing `fetch` injection; do not add a TLS bypass.
- Leave `LangfuseTraceRepository` round-evidence semantics unchanged. Its current v2 page-number contract is different from the cursor-based case-import endpoint.
- Keep this operation synchronous and bounded to 40 requested cases; no new job, schema migration, or remote Agent Platform contract.

Files expected to change:

- Create `packages/adapters/src/langfuse/case-import-repository.ts` and its test. This adapter owns v2/legacy reads, cursor pagination, input normalization, and one-candidate-per-trace selection.
- Modify `packages/adapters/src/index.ts` only if needed to export the adapter.
- Modify `packages/adapters/src/sqlite/case-repository.ts` and its test to atomically skip existing IDs for this import path while preserving existing `saveMany` conflict behavior for other imports.
- Modify `apps/api/src/routes/cases.ts` and `apps/api/src/routes/cases.test.ts` for the Langfuse import endpoint and its validation/status contract.
- Modify `apps/api/src/server.ts` only to inject the existing SQLite database, encrypted secret store, and `fetch` into the route dependencies.
- Modify `apps/web/src/features/cases/agent-case-form.tsx` and its test, `apps/web/e2e/app.spec.ts`, and `apps/web/src/i18n/messages.ts` for the new intake mode.
- Update `docs/api.md` and `docs/guia-do-usuario.md` with bounds, provenance, idempotency, fallback, and v2-delay limitations.

## Task 1: Add a dedicated Langfuse trace-to-case source adapter

**Files:** Create `packages/adapters/src/langfuse/case-import-repository.ts`, `packages/adapters/src/langfuse/case-import-repository.test.ts`; modify `packages/adapters/src/index.ts` if exports are required.

- [ ] **Step 1: Write focused failing tests for the v2 cursor contract.** Use an injected `LangfuseClient` fetch stub and deterministic delay. Assert each request has `fromStartTime`, `toStartTime`, `isRootObservation=true`, `fields=core,basic,io,trace_context`, and a page-two `cursor` equal to page one's `meta.cursor`. Return cursor-paginated fixtures (not `meta.page/totalPages`); verify a 429 is retried once with bounded `retry-after`, and a persistent 429 fails with a sanitized adapter error.
- [ ] **Step 2: Run the adapter test and confirm it fails for missing importer.** Run `pnpm --filter @harness-lab/adapters test -- case-import-repository.test.ts`; expected: the new module/export is absent or the focused assertions fail.
- [ ] **Step 3: Define a minimal import candidate contract.** Export a candidate type containing only `traceId`, `sessionId`, `similarityGroup`, `content`, and `startTime`, plus a result containing `candidates`, `skipped`, and `limitations`. Do not reuse `Evidence`, because this is input corpus data rather than round evidence.
- [ ] **Step 4: Add v2 pagination and parsing.** Fetch bounded pages until the requested number of unique root traces with serializable input is reached or no cursor remains. Parse response shape with Zod; accept `input` as string, object, or array; preserve strings and compact-JSON stringify objects/arrays. A malformed page fails safely; a root observation with absent/unserializable/empty input increments `skipped` and is not emitted. Stop on repeated cursor to prevent an infinite loop.
- [ ] **Step 5: Select one candidate per trace deterministically.** Group by `traceId`; prefer `isRootObservation=true`, then earliest valid `startTime`; accept only the selected observation's serializable input. Set `sessionId` to non-empty `sessionId` or `traceId`; set `similarityGroup` to non-empty `traceName`, then `name`, then `langfuse`. Respect `CaseRecord` limits (`sessionId` 200, `similarityGroup` 200, `content` 20,000, `sourceReference` 500): use the next documented fallback where available and count an otherwise unrepresentable candidate as skipped rather than truncating its input.
- [ ] **Step 6: Add explicit negotiated legacy handling.** When constructed with legacy capability, request only `/api/public/traces` with `fromTimestamp`/`toTimestamp`, normalize `id`, `input`, `timestamp`, and optional session/name fields into the same candidate shape, and include a deprecated-endpoint limitation. Do not fallback after 401/403, timeout, 429 exhaustion, or schema failure.
- [ ] **Step 7: Run focused adapter tests.** Run `pnpm --filter @harness-lab/adapters test -- case-import-repository.test.ts`; expected: all cursor, bounds, mapping, duplicate-trace, input-shape, skip, retry, and legacy tests pass. Also run `pnpm --filter @harness-lab/adapters typecheck`.

## Task 2: Make SQLite case import idempotent and add the API endpoint

**Files:** Modify `packages/adapters/src/sqlite/case-repository.ts`, `packages/adapters/src/sqlite/case-repository.test.ts`, `apps/api/src/routes/cases.ts`, `apps/api/src/routes/cases.test.ts`, and `apps/api/src/server.ts`.

- [ ] **Step 1: Add a failing repository test for transactional insert-or-skip.** Verify a batch with one new case and one existing ID persists only the new case and reports one insertion; verify duplicate IDs within the submitted batch still fail; verify an invalid scope causes no partial write. Keep the existing `saveMany` test proving regular imports still fail atomically on duplicates.
- [ ] **Step 2: Run the focused repository test and confirm failure.** Run `pnpm --filter @harness-lab/adapters test -- case-repository.test.ts`; expected: the new idempotent method/behavior is missing.
- [ ] **Step 3: Implement an explicit idempotent repository method.** Add a separate method (for example `saveManyIgnoringExisting`) that validates all records and intra-batch IDs, executes inserts in one SQLite transaction with conflict-ignore limited to `cases.id`, preserves foreign-key/scope failures, flushes once after success, and returns the inserted count. Do not change `saveMany` semantics.
- [ ] **Step 4: Add route tests before route implementation.** Cover request validation (ISO timestamps, start < end, limit 1–40), missing connection, non-Langfuse connection, absent/mismatched agent-domain, invalid credentials, upstream unavailable, ignored invalid-input traces, duplicate source references, no secrets/outputs in response, and atomic persistence. Assert a repeated identical request returns `imported: 0` with an increased `skipped` count and leaves exactly one case.
- [ ] **Step 5: Run the focused route test and confirm the endpoint is missing.** Run `pnpm --filter @harness-lab/api test -- cases.test.ts`; expected: the route tests fail until it is registered.
- [ ] **Step 6: Add the route dependency contract and validation.** Inject `SqliteDatabase`, `SecretStore`, `SqliteCaseRepository`, and `fetch` via a route dependency object. Validate the body as `{agentId, domainId, connectionId, fromStartTime, toStartTime, limit}`; use stable errors from the spec: `CASE_LANGFUSE_INVALID`, `CONNECTION_NOT_FOUND`, `CONNECTION_KIND_INVALID`, `AGENT_SCOPE_INVALID`, `CONNECTION_AUTH_FAILED`, `CONNECTION_UNAVAILABLE`.
- [ ] **Step 7: Validate scope and connection before outbound reads.** Query `agents` for exact `(id, domain_id)` and `connection_registrations` for `id, kind`; reject absent scope/connection or wrong kind before contacting Langfuse. Decrypt via `secretStore.get(connectionId as SecretId)`, parse only `{baseUrl, publicKey, secretKey}` from its JSON value, and never expose the parsed value in errors or logs.
- [ ] **Step 8: Compose and execute the import.** Construct `LangfuseClient` using validated credentials and the injected `fetch`; call `negotiateLangfuseCapabilities`; query the new adapter; list the existing scope to filter deterministic case IDs; then call the idempotent repository method only when there are new candidates. ID formula: `langfuse-` + the first 64 hex characters of SHA-256 over `${connectionId}:${traceId}` (73 characters total, under the 120-character limit). Persist `source: "historical"`, `sourceReference: "langfuse:<connectionId>:<traceId>"`, `createdAt` at import time, and mapped session/group/content. Compute `skipped` as adapter-rejected candidates plus candidates already present; merge capability and adapter limitations without including trace data. The response is `{ imported, skipped, source: {connectionId, fromStartTime, toStartTime}, limitations }` with HTTP 201 only; never include candidates or remote body.
- [ ] **Step 9: Map integration failures without leaking upstream details.** Map capability/auth failures to `422 CONNECTION_AUTH_FAILED`; timeouts, rate-limit exhaustion, failed reads, and malformed upstream payload to `503 CONNECTION_UNAVAILABLE`; keep validation and scope errors as their specified 400/404/422 codes. Do not retry 401/403 or schema failures.
- [ ] **Step 10: Run focused adapter, API, and typecheck gates.** Run `pnpm --filter @harness-lab/adapters test -- case-repository.test.ts case-import-repository.test.ts`, `pnpm --filter @harness-lab/api test -- cases.test.ts`, then `pnpm --filter @harness-lab/api typecheck`; expected: all pass and existing CSV/JSON case routes remain unchanged.

## Task 3: Add Langfuse import mode to the case-intake UI

**Files:** Modify `apps/web/src/features/cases/agent-case-form.tsx`, `apps/web/src/features/cases/agent-case-form.test.tsx`, `apps/web/src/i18n/messages.ts`, and `apps/web/e2e/app.spec.ts`.

- [ ] **Step 1: Add failing component tests for successful import and payload bounds.** Mock `GET /api/v1/connections` with Langfuse and Agent Platform entries. Select Langfuse mode and assert the picker contains only the Langfuse entry, dates and limit are submitted to `POST /api/v1/cases/import-langfuse`, and the payload includes the active agent/domain. Verify success text includes imported and skipped counts and legacy limitations when returned.
- [ ] **Step 2: Add tests for invalid dates/limit, no saved Langfuse connection, network error, and sanitized API errors.** Assert invalid values make no POST, no-connections state is actionable, and JSON/CSV existing requests remain unchanged.
- [ ] **Step 3: Run the focused UI tests and confirm they fail.** Run `pnpm --filter @harness-lab/web test -- agent-case-form.test.tsx`; expected: no Langfuse controls/statuses exist yet.
- [ ] **Step 4: Add a Langfuse source option without replacing existing sources.** Preserve manual/JSON/historical/synthetic and CSV flows. When Langfuse is selected, render saved-connection selection, `datetime-local` range inputs, and integer limit defaulting to 20 with HTML bounds 1–40; do not render JSON/CSV content fields for this mode.
- [ ] **Step 5: Load and validate public connection summaries.** Fetch `GET /api/v1/connections`, validate response shape using the existing summary contract, filter `kind === "langfuse"`, and show loading/error/empty states. Never call `/credentials` or handle secrets in this flow.
- [ ] **Step 6: Submit and present bounded results.** Require valid ordered local dates, selected Langfuse connection, and integer limit 1–40; convert the selected dates to ISO 8601 strings with `Date.toISOString()` before submitting the API contract fields. Render imported/skipped counts and limitations from the sanitized response, plus distinct messages for auth failure, unavailable service, invalid scope, and generic request failure. Disable the submit button while importing.
- [ ] **Step 7: Add all new visible strings to `messages.ts` in en, pt-BR, and es.** Include source option, connection/date/limit labels, loading/empty/error states, importing state, success counts, legacy warning, invalid form, auth failure, and unavailable error. Keep each locale key set complete.
- [ ] **Step 8: Run UI tests, web typecheck, and build.** Run `pnpm --filter @harness-lab/web test -- agent-case-form.test.tsx`, `pnpm --filter @harness-lab/web typecheck`, and `pnpm --filter @harness-lab/web build`; expected: all pass and old case-intake tests pass.

## Task 4: Document and verify the end-to-end flow

**Files:** Modify `apps/web/e2e/app.spec.ts`, `docs/api.md`, and `docs/guia-do-usuario.md`.

- [ ] **Step 1: Add a mocked Playwright import scenario.** Stub `GET /api/v1/connections` with one Langfuse and one Agent Platform item, stub the import route with `{imported: 2, skipped: 1, source: ..., limitations: []}`, complete agent setup, import, and assert the selected scope, count status, and no horizontal overflow at configured viewports. Ensure the scenario does not depend on a real Langfuse service.
- [ ] **Step 2: Update API reference.** Document `POST /cases/import-langfuse`, the exact request/response fields, maximum 40, time-bound requirement, status/error codes, idempotency, root observation/input mapping, legacy deprecation notice, bounded retry, and sensitive-data guarantees.
- [ ] **Step 3: Update user guide.** Explain selecting a saved Langfuse connection, the time window and 1–40 limit, which input becomes case content, what is skipped, how repeated imports behave, why outputs are not copied, and that v2 may delay older SDK/OTEL data. Explain the legacy limitation when returned.
- [ ] **Step 4: Run all checks.** Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`; expected: all pass. Run `pnpm test:e2e` when a compatible Playwright browser is available; if the host browser is unsupported, report that environment limitation without treating it as a product pass.
- [ ] **Step 5: Perform a credential-safe, opt-in live smoke test.** Only when a configured Langfuse connection is explicitly available, import a narrow time range with limit 1, verify at least one case appears in the selected scope, repeat the same request to verify no duplicates, and inspect only status/counts/source reference—not credentials or raw trace content. Do not print or persist secrets in terminal output.
- [ ] **Step 6: Review the final diff.** Confirm only the planned importer/UI/docs files plus any required adapter exports changed; confirm the pre-existing connection-list changes remain intact and unstaged unless separately requested.

## Completion criteria

- A bounded real or mocked import creates up to 40 historical cases in exactly the selected agent/domain.
- v2 reads use selective fields and cursor pagination; legacy reads are explicit and surfaced as a limitation.
- Repeating the same import creates no duplicate cases and reports skips.
- Inputs are normalized, outputs and raw traces are never returned, and credentials remain server-side.
- JSON, CSV, manual, historical, and synthetic intake behavior remains compatible.
- Adapter/API/UI tests, typecheck, build, and diff checks pass; E2E and live smoke results are reported with their environment constraints.
