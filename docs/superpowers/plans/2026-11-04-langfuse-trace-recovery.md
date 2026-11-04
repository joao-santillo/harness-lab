# Langfuse Trace Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search-preview-review-confirm flow for Langfuse traces with individual discard reasons and user-controlled selection.

**Architecture:** The Langfuse adapter will classify every examined trace as ready or discarded instead of collapsing failures into a counter. The API will create short-lived opaque previews that keep case content server-side, expose metadata for review, and confirm only selected ready traces. The React form will split search from import and present summary tabs for ready, existing, and discarded traces.

**Tech Stack:** TypeScript 5.9, Fastify 5, React 19, Zod 4, SQLite adapter, Vitest, Testing Library

---

## File Structure

- Modify `packages/adapters/src/langfuse/case-import-repository.ts`: classify each trace and expose typed discard reasons.
- Modify `packages/adapters/src/langfuse/case-import-repository.test.ts`: characterize each classification and total-trace limiting.
- Create `apps/api/src/routes/langfuse-import-preview-store.ts`: own preview creation, expiration, validation, consumption, and bounded in-memory storage.
- Create `apps/api/src/routes/langfuse-import-preview-store.test.ts`: unit-test preview lifecycle independently of HTTP and Langfuse.
- Modify `apps/api/src/routes/cases.ts`: add preview/confirm routes and retain the legacy direct-import route.
- Modify `apps/api/src/routes/cases.test.ts`: verify safe preview metadata, no write during search, selected confirmation, expiration, and races.
- Modify `apps/api/src/server.ts`: construct and inject one preview store per server.
- Modify `apps/web/src/features/cases/agent-case-form.tsx`: model preview state, selection, tabs, invalidation, and confirmation.
- Modify `apps/web/src/features/cases/agent-case-form.test.tsx`: verify the complete user workflow and error states.
- Modify `apps/web/src/i18n/messages.ts`: add labels, statuses, reasons, and results in all existing locales.
- Modify `apps/web/src/styles.css`: add restrained summary, tab, and trace-list styling consistent with the existing application.
- Modify `docs/api.md`: document preview and confirmation contracts.
- Modify `docs/guia-do-usuario.md`: document search, review, selection, and discard reasons.

### Task 1: Return Individual Trace Classifications

**Files:**
- Modify: `packages/adapters/src/langfuse/case-import-repository.ts`
- Test: `packages/adapters/src/langfuse/case-import-repository.test.ts`

- [ ] **Step 1: Write failing tests for ready and discarded trace results**

Add focused cases beside the existing root/fallback tests:

```ts
it("classifies every examined trace with an individual result", async () => {
  const repository = repositoryWithV2Response([
    root({ traceId: "ready", input: { prompt: "hello" } }),
    root({ traceId: "missing-input", input: null }),
    child({ traceId: "missing-root", input: "orphan" }),
  ]);

  const result = await repository.importCases(validQuery({ limit: 3 }));

  expect(result.items).toEqual([
    expect.objectContaining({ status: "ready", traceId: "ready" }),
    expect.objectContaining({ status: "discarded", traceId: "missing-input", reason: "MISSING_USABLE_INPUT" }),
    expect.objectContaining({ status: "discarded", traceId: "missing-root", reason: "MISSING_ROOT" }),
  ]);
});
```

Use the test file's existing client/response helpers instead of introducing duplicate fixtures. Add one test per remaining reason using inputs that isolate `INVALID_START_TIME`, `CONTENT_TOO_LARGE`, `INVALID_SESSION_ID`, `SOURCE_REFERENCE_TOO_LARGE`, and `INVALID_CONTENT`.

- [ ] **Step 2: Run the adapter test to verify it fails**

Run:

```bash
pnpm --filter @harness-lab/adapters test -- case-import-repository.test.ts
```

Expected: FAIL because `items` and discard reason types do not exist.

- [ ] **Step 3: Add the discriminated result types and classification function**

Replace `skipped` with explicit types:

```ts
export type LangfuseTraceDiscardReason =
  | "MISSING_ROOT"
  | "MISSING_USABLE_INPUT"
  | "INVALID_START_TIME"
  | "CONTENT_TOO_LARGE"
  | "INVALID_SESSION_ID"
  | "SOURCE_REFERENCE_TOO_LARGE"
  | "INVALID_CONTENT";

export type LangfuseTraceRecoveryItem =
  | { readonly status: "ready"; readonly traceId: string; readonly candidate: LangfuseCaseImportCandidate }
  | { readonly status: "discarded"; readonly traceId: string; readonly startTime?: string; readonly reason: LangfuseTraceDiscardReason };

export interface LangfuseCaseImportResult {
  readonly items: readonly LangfuseTraceRecoveryItem[];
  readonly limitations: readonly string[];
}
```

Change serialization to preserve failure cause:

```ts
type SerializedInput =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: "MISSING_USABLE_INPUT" | "INVALID_CONTENT" };
```

Refactor `#toCandidate` to return one `LangfuseTraceRecoveryItem`. Evaluate trace-level failures in deterministic priority order: missing root, usable input, valid time, content size, source reference size, and session validity. Preserve root-first then oldest-child ordering.

- [ ] **Step 4: Make the limit apply to total trace results**

Replace `currentCandidates()` with `currentItems()` and stop pagination when `items.length >= query.limit`. Sort items by valid `startTime`, falling back to `traceId`, then return `items.slice(0, query.limit)`.

- [ ] **Step 5: Run the focused adapter tests**

Run:

```bash
pnpm --filter @harness-lab/adapters test -- case-import-repository.test.ts
```

Expected: PASS, including existing filtering, pagination, fallback, size, and sanitization tests.

- [ ] **Step 6: Commit the adapter classification**

```bash
git add packages/adapters/src/langfuse/case-import-repository.ts packages/adapters/src/langfuse/case-import-repository.test.ts
git commit -m "feat: classify Langfuse trace recovery results"
```

### Task 2: Add a Bounded Preview Store

**Files:**
- Create: `apps/api/src/routes/langfuse-import-preview-store.ts`
- Create: `apps/api/src/routes/langfuse-import-preview-store.test.ts`

- [ ] **Step 1: Write lifecycle tests for the preview store**

Cover creation, retrieval, consumption, expiration, foreign trace IDs, and capacity eviction:

```ts
it("stores ready candidates server-side and consumes a valid selection once", () => {
  let now = Date.parse("2026-11-04T15:00:00.000Z");
  const store = new LangfuseImportPreviewStore({ now: () => now, ttlMs: 300_000, capacity: 2 });
  const preview = store.create({
    agentId: "agent", domainId: "domain", connectionId: "connection",
    ready: [candidate("trace-a"), candidate("trace-b")],
  });

  expect(store.consume(preview.previewId, ["trace-b"])).toMatchObject({
    agentId: "agent",
    candidates: [expect.objectContaining({ traceId: "trace-b" })],
  });
  expect(() => store.consume(preview.previewId, ["trace-b"])).toThrow("PREVIEW_EXPIRED");
});
```

For invalid selection, assert `PREVIEW_SELECTION_INVALID`. Advance `now` past five minutes for expiration. Create three previews at capacity two and assert the oldest is unavailable.

- [ ] **Step 2: Run the store test to verify it fails**

Run:

```bash
pnpm --filter @harness-lab/api test -- langfuse-import-preview-store.test.ts
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement the store with explicit dependencies**

Create the store around a private `Map`:

```ts
export interface LangfuseImportPreviewStoreOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly capacity?: number;
  readonly createId?: () => string;
}

export class LangfuseImportPreviewStore {
  // create(input): { previewId, expiresAt }
  // consume(previewId, traceIds): selected candidates plus bound scope
}
```

Use `randomBytes(24).toString("base64url")` as the default ID, a five-minute TTL, and capacity 100. Purge expired records before create/consume; evict the oldest expiry when capacity is reached. Reject empty, duplicate, unknown, or non-ready selections with `PREVIEW_SELECTION_INVALID`. Delete the preview only after validating the full selection.

- [ ] **Step 4: Run the focused store tests**

Run:

```bash
pnpm --filter @harness-lab/api test -- langfuse-import-preview-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the preview store**

```bash
git add apps/api/src/routes/langfuse-import-preview-store.ts apps/api/src/routes/langfuse-import-preview-store.test.ts
git commit -m "feat: add Langfuse import preview store"
```

### Task 3: Expose Preview and Confirm API Routes

**Files:**
- Modify: `apps/api/src/routes/cases.ts`
- Modify: `apps/api/src/routes/cases.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write a failing API test for preview without persistence**

Extend the existing Langfuse route fixture so the remote response has one valid trace, one root without input, and one rootless trace. Call the preview endpoint and assert:

```ts
expect(response.statusCode).toBe(200);
expect(response.json()).toMatchObject({
  previewId: expect.any(String),
  expiresAt: expect.any(String),
  summary: { found: 3, ready: 1, alreadyImported: 0, discarded: 2 },
  items: expect.arrayContaining([
    expect.objectContaining({ traceId: "trace-ready", status: "ready" }),
    expect.objectContaining({ traceId: "trace-empty", status: "discarded", reason: "MISSING_USABLE_INPUT" }),
    expect.objectContaining({ traceId: "trace-orphan", status: "discarded", reason: "MISSING_ROOT" }),
  ]),
});
expect(response.body).not.toContain("customer question");
expect((await listCases(server, "agent", "domain")).items).toHaveLength(0);
```

- [ ] **Step 2: Run the API test to verify it fails**

Run:

```bash
pnpm --filter @harness-lab/api test -- cases.test.ts
```

Expected: FAIL with preview route not found.

- [ ] **Step 3: Add schemas and preview-store dependency**

In `cases.ts`, reuse the existing Langfuse search schema for `/preview` and add:

```ts
const langfuseConfirmSchema = z.object({
  previewId: z.string().min(16).max(200),
  traceIds: z.array(z.string().min(1).max(200)).min(1).max(40),
});
```

Add `previewStore: LangfuseImportPreviewStore` to `CaseRouteDependencies`. In `server.ts`, create one store and inject it into `registerCaseRoutes`.

- [ ] **Step 4: Implement preview classification and existing-case lookup**

Extract private route helpers for credential resolution and adapter construction so legacy and preview routes share validation. For each ready adapter item, compute `langfuseCaseId(connectionId, traceId)` and query the cases table/repository to divide it into ready or already imported. Store only ready candidates with bound agent/domain/connection. Return review metadata only:

```ts
{
  traceId,
  status: "ready" | "alreadyImported" | "discarded",
  traceName,
  sessionId,
  startTime,
  ...(status === "alreadyImported" ? { caseId } : {}),
  ...(status === "discarded" ? { reason } : {}),
}
```

Do not include `candidate.content` in the response.

- [ ] **Step 5: Run the preview API test**

Run:

```bash
pnpm --filter @harness-lab/api test -- cases.test.ts
```

Expected: the new preview test passes; confirmation tests are not added yet.

- [ ] **Step 6: Write failing confirmation and race tests**

Create a preview containing two ready traces, confirm only one, and assert only that case exists. Add assertions for:

```ts
expect(confirm.json()).toEqual({ requested: 1, imported: 1, alreadyImported: 0 });
expect(reuse.statusCode).toBe(410);
expect(reuse.json()).toEqual({ code: "PREVIEW_EXPIRED" });
expect(invalidSelection.statusCode).toBe(400);
expect(invalidSelection.json()).toEqual({ code: "PREVIEW_SELECTION_INVALID" });
```

For the race test, persist the deterministic case after preview and before confirm; expect `{ requested: 1, imported: 0, alreadyImported: 1 }`.

- [ ] **Step 7: Implement the confirmation route**

Consume the preview, map selected candidates to `CaseRecord`, and call `saveManyIgnoringExisting`. Respond with requested/imported/alreadyImported. Map store errors exactly:

```ts
if (code === "PREVIEW_EXPIRED") return reply.code(410).send({ code });
if (code === "PREVIEW_SELECTION_INVALID") return reply.code(400).send({ code });
```

Keep `POST /api/v1/cases/import-langfuse` working by adapting it to `result.items.filter(item => item.status === "ready")` and preserve its existing response contract.

- [ ] **Step 8: Run all API route tests**

Run:

```bash
pnpm --filter @harness-lab/api test -- cases.test.ts
```

Expected: PASS for preview, confirmation, legacy route, validation, and sanitization.

- [ ] **Step 9: Commit the API workflow**

```bash
git add apps/api/src/routes/cases.ts apps/api/src/routes/cases.test.ts apps/api/src/server.ts
git commit -m "feat: preview and confirm Langfuse trace imports"
```

### Task 4: Build the Search and Review Interface

**Files:**
- Modify: `apps/web/src/features/cases/agent-case-form.tsx`
- Modify: `apps/web/src/features/cases/agent-case-form.test.tsx`
- Modify: `apps/web/src/i18n/messages.ts`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Replace the direct-import test with a failing preview workflow test**

Mock `/preview` with ready, existing, and discarded items. Assert that clicking **Search traces** sends the existing filter payload, displays the four summary counts, and does not call `/confirm`.

```ts
expect(await screen.findByText("3 found")).toBeVisible();
expect(screen.getByRole("tab", { name: "Ready 1" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("button", { name: "Import 1 trace" })).toBeEnabled();
expect(request).not.toHaveBeenCalledWith("/api/v1/cases/import-langfuse/confirm", expect.anything());
```

- [ ] **Step 2: Run the web test to verify it fails**

Run:

```bash
pnpm --filter @harness-lab/web test -- agent-case-form.test.tsx
```

Expected: FAIL because the form still imports directly.

- [ ] **Step 3: Add typed preview state and split search from confirmation**

Define local discriminated response types and states:

```ts
type LangfuseReviewTab = "ready" | "alreadyImported" | "discarded";
type LangfusePreviewStatus = "idle" | "searching" | "ready" | "confirming" | "expired" | "failed";

interface LangfusePreview {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly summary: { found: number; ready: number; alreadyImported: number; discarded: number };
  readonly items: readonly LangfusePreviewItem[];
  readonly limitations: readonly string[];
}
```

Change Langfuse form submission to call `/api/v1/cases/import-langfuse/preview`, initialize `selectedTraceIds` from ready items, and choose the first non-empty tab in order ready, discarded, already imported. Add a separate confirm handler posting `{ previewId, traceIds: [...selectedTraceIds] }`.

- [ ] **Step 4: Add failing selection and tab tests**

Verify ready checkboxes are checked by default, one can be cleared, **Clear selection** disables import, **Select all** restores it, and discarded rows show translated individual reasons. Use `getByRole("tab")`, `getByRole("tabpanel")`, and labeled checkboxes to enforce accessible semantics.

- [ ] **Step 5: Render summary, tabs, trace rows, and dynamic action**

Use a compact unframed summary row followed by a `role="tablist"`. Ready rows use native checkboxes. Existing and discarded rows contain no checkbox. Keep stable columns for name, session, time, and status; abbreviate the trace ID visually while exposing the full ID through `title`.

Do not add nested cards. Keep the detailed list in the existing form section and use the app's current borders, spacing variables, focus styles, and maximum widths.

- [ ] **Step 6: Add translations in all existing locales**

Add keys for search, searching, summary labels, tabs, select all, clear selection, dynamic singular/plural import text, empty result, no selection, expiration, final imported/existing result, and every discard reason. Remove use of `langfuseImportSuccess` from this flow; do not display “Ignored” or “Skipped”.

- [ ] **Step 7: Add failing preview invalidation and expiration tests**

After preview, change the connection, date, limit, filter field, or filter value and assert the tablist disappears and import cannot run. Mock confirm with `410` and assert **Preview expired. Search again.** plus an enabled **Search again** action.

- [ ] **Step 8: Implement invalidation and terminal states**

Centralize `clearLangfusePreview()` and call it from every search-parameter change. Preserve form values on failure. After successful confirmation, show imported and newly existing counts separately, clear the consumed preview, and reload cases.

- [ ] **Step 9: Run focused web tests**

Run:

```bash
pnpm --filter @harness-lab/web test -- agent-case-form.test.tsx
```

Expected: PASS for search, tabs, selection, reasons, invalidation, expiration, and existing non-Langfuse imports.

- [ ] **Step 10: Run the web typecheck**

Run:

```bash
pnpm --filter @harness-lab/web typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 11: Commit the review UI**

```bash
git add apps/web/src/features/cases/agent-case-form.tsx apps/web/src/features/cases/agent-case-form.test.tsx apps/web/src/i18n/messages.ts apps/web/src/styles.css
git commit -m "feat: review and select Langfuse traces"
```

### Task 5: Document and Verify the Complete Flow

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/guia-do-usuario.md`

- [ ] **Step 1: Update API documentation**

Document `/preview` and `/confirm` request/response examples, five-minute expiration, one-time consumption, error codes, individual discard reasons, and the temporary compatibility status of `/import-langfuse`.

- [ ] **Step 2: Update the user guide**

Describe **Search traces**, the four summary values, the three review tabs, default selection, individual selection, and how to act on each discard reason. State that changing filters requires a new search.

- [ ] **Step 3: Run adapter, API, and web tests**

Run:

```bash
pnpm --filter @harness-lab/adapters test -- case-import-repository.test.ts
pnpm --filter @harness-lab/api test -- langfuse-import-preview-store.test.ts cases.test.ts
pnpm --filter @harness-lab/web test -- agent-case-form.test.tsx
```

Expected: all focused suites PASS.

- [ ] **Step 4: Run repository gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all test suites, typechecks, and builds PASS; `git diff --check` produces no output.

- [ ] **Step 5: Inspect the UI at desktop and mobile widths**

Start the development server:

```bash
pnpm --filter @harness-lab/web dev
```

Use the existing Playwright setup to inspect at 1440×900 and 390×844. Confirm no overlapping text, summary counts remain readable, tabs are keyboard reachable, trace rows do not resize when selected, and the dynamic action remains visible without obscuring content.

- [ ] **Step 6: Commit documentation and final verification changes**

```bash
git add docs/api.md docs/guia-do-usuario.md
git commit -m "docs: explain Langfuse trace review workflow"
```