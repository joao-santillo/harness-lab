# Agent Platform Harness Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the user-facing workflow, multilingual operations, accessibility, observability, upgrade gates, documentation, and verified MVP demonstration.

**Architecture:** Extend the existing React operations interface over versioned API and SSE contracts. Keep presentation state separate from durable round state, use stable message codes for all locales, and verify the product through Playwright, visual, accessibility, contract, and real bounded smoke suites.

**Tech Stack:** React, Vite, TanStack Query, React Router, i18next, Playwright, axe-core, Vitest, Pino.

---

### Task 1: Complete agent registration UX

**Files:**
- Modify: `apps/web/src/features/agents/agent-wizard.tsx`
- Create: `apps/web/src/features/agents/capability-review.tsx`
- Create: `apps/web/src/features/agents/success-criteria.tsx`
- Test: `apps/web/src/features/agents/agent-wizard.test.tsx`

- [ ] Test connection test/replace/delete, project-agent-version selection, capability review, domain, immutable rules, criteria, limits, and final confirmation.
- [ ] Implement masked secrets, destructive-action confirmation, unsupported capability explanations, keyboard focus, and recoverable errors.
- [ ] Verify responsive layouts and all three locales.
- [ ] Commit with `git commit -m "feat: complete agent registration experience"`.

### Task 2: Complete round setup and live progress

**Files:**
- Create: `apps/web/src/features/rounds/round-setup.tsx`
- Create: `apps/web/src/features/rounds/sample-review.tsx`
- Create: `apps/web/src/features/rounds/round-progress.tsx`
- Test: `apps/web/src/features/rounds/round-progress.test.tsx`

- [ ] Test objective, trace filters, cases, budgets, thresholds, diagnosis/validation counts, removal of unsuitable cases, and confirmation.
- [ ] Test ordered SSE events, reconnect with last event ID, real counters, consumed limits, cancellation, leave/return, restart resume, and sanitized errors.
- [ ] Implement stage labels without fictitious percentages and distinguish missing trace, integration failure, evaluator failure, and poor output.
- [ ] Commit with `git commit -m "feat: show durable improvement round progress"`.

### Task 3: Build evidence-led results and history

**Files:**
- Create: `apps/web/src/features/results/result-summary.tsx`
- Create: `apps/web/src/features/results/evidence-chain.tsx`
- Create: `apps/web/src/features/results/harness-diff.tsx`
- Create: `apps/web/src/features/history/round-history.tsx`
- Test: `apps/web/src/features/results/result-summary.test.tsx`

- [ ] Test all decision states, confidence, critical failures, regressions, sample, cost, latency, uncertainty, and limitations.
- [ ] Test drill-down from problem to evidence, hypothesis, change, and result.
- [ ] Implement plain-language and technical Agent Platform diffs, report/candidate downloads, technical-review request, reject-with-reason, and new-round actions.
- [ ] Assert there is no publish-to-production action.
- [ ] Commit with `git commit -m "feat: present auditable round results"`.

### Task 4: Finish multilingual logs and content

**Files:**
- Modify: `apps/web/src/i18n/*`
- Create: `packages/application/src/i18n/catalog.ts`
- Create: `packages/adapters/src/logging/localized-logger.ts`
- Test: `packages/application/src/i18n/catalog.test.ts`

- [ ] Test exact key parity among `pt-BR`, `en`, and `es`, interpolation typing, browser preference, user switch, and fallback to `pt-BR`.
- [ ] Test localized UI, API errors, worker progress, logs, reports, findings, exports, and terminal states.
- [ ] Preserve original trace/prompt/response content and label optional translations separately.
- [ ] Map sanitized external errors to stable localized application codes.
- [ ] Commit with `git commit -m "feat: localize product and operational logs"`.

### Task 5: Add full Playwright and accessibility coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/agent-round.spec.ts`
- Create: `tests/e2e/recovery.spec.ts`
- Create: `tests/e2e/locales.spec.ts`
- Create: `tests/e2e/visual.spec.ts`

- [ ] Cover credential setup, agent registration, paginated collection, baseline generation, partition review, complete round, export, cancellation, resume, history, critical rejection, missing trace, and integration failures.
- [ ] Test keyboard-only operation, focus order, accessible names, dialogs, status announcements, desktop/mobile viewports, long translations, masking, and downloads.
- [ ] Run axe-core checks with zero serious or critical violations.
- [ ] Capture reviewed screenshots for primary screens in every locale and viewport; fail on unapproved changes.
- [ ] Commit with `git commit -m "test: verify complete accessible user journey"`.

### Task 6: Add CI and dependency upgrade gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `scripts/verify-upgrade.ts`
- Create: `scripts/scan-secrets.ts`

- [ ] Configure jobs for lint/typecheck, unit/property, contract/characterization, migration, integration, build, hermetic E2E, interface/visual/accessibility, secret scanning, and dependency auditing.
- [ ] Make external smoke tests manual and environment-protected with strict limits.
- [ ] Make contract snapshot or visual changes upload reviewable artifacts instead of auto-accepting them.
- [ ] Make dependency updates run the deterministic demonstration and fail on semantic drift.
- [ ] Commit with `git commit -m "ci: enforce product and dependency quality gates"`.

### Task 7: Document operations and architecture

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/operations.md`
- Create: `docs/security.md`
- Create: `docs/demo.md`
- Create: `docs/limitations.md`

- [ ] Document local prerequisites, install, encryption key generation, processes, safe credential entry, test environments, data directory, backups, migrations, cancellation/recovery, retention, and troubleshooting.
- [ ] Document ports/adapters, source links, pinned Harness2 version, Langfuse fallback, Agent Platform capability boundaries, security model, and future PostgreSQL/object-storage/vault migration.
- [ ] Document the exact bounded demonstration and expected evidence or explicit blocker.
- [ ] Validate every command in a clean checkout.
- [ ] Commit with `git commit -m "docs: add deployment and demonstration guides"`.

### Task 8: Run the MVP acceptance demonstration

**Files:**
- Create: `docs/evidence/mvp-acceptance.md`
- Create: `docs/evidence/screenshots/*`

- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Run contract, characterization, migration, integration, hermetic E2E, visual, and accessibility suites.
- [ ] Start API, worker, and web on available ports and record the local URL.
- [ ] Execute the bounded real demonstration: connect, select agent/version, collect or generate baseline, diagnose, propose, execute baseline/candidate, validate reserved cases, decide, and export.
- [ ] Record versions, limits, sanitized outcomes, hashes, screenshots, and any explicit validation blocker without credentials or raw sensitive content.
- [ ] Commit with `git commit -m "test: record MVP acceptance evidence"`.

## Product Exit Gate

- [ ] Every acceptance criterion in the approved specification has a passing automated check or documented bounded real demonstration.
- [ ] No plaintext secret appears in Git history, logs, reports, screenshots, exports, or browser storage.
- [ ] The application URL, startup commands, and demonstration evidence are documented.
- [ ] Production publication remains impossible from the MVP interface and API.
