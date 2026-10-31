# Harness Lab - Design Specification

## 1. Purpose

Build an MVP that continuously and verifiably improves the execution harness of AI agents hosted on Agent Platform. The application uses Langfuse traces to diagnose behavior, proposes small harness changes through an adapted Harness2 Propose-Probe-Compose cycle, executes baseline and candidate versions on Agent Platform, evaluates them independently, and exports a justified candidate without publishing it automatically.

The primary user is a non-technical or moderately technical agent owner. A successful MVP lets this user follow one complete round from trace collection to candidate export, or clearly explains why validation could not be completed.

## 2. Scope

### 2.1 In scope

- Register and select multiple agents without changing the application core.
- Register Agent Platform and Langfuse connections through the frontend.
- Detect integration capabilities instead of assuming endpoint availability.
- Collect, paginate, resume, deduplicate, and reconstruct Langfuse executions.
- Generate baseline traces by executing reviewed cases when historical traces are insufficient.
- Diagnose successful and failed executions with traceable evidence.
- Adapt Harness2 Propose-Probe-Compose and reflection concepts to Agent Platform.
- Execute baseline and candidate harness versions under comparable conditions.
- Evaluate candidates independently from the refinement engine.
- Persist rounds, versions, evidence, results, decisions, and scoped learnings.
- Present real progress, cancellation, history, comparisons, and exports.
- Support Portuguese, English, and Spanish.

### 2.2 Out of scope for the MVP

- Automatic publication or promotion to Agent Platform production.
- Editing Agent Platform capabilities not proven by its API contract.
- Treating historical outputs as ground truth.
- Executing instructions found inside trace content.
- A distributed multi-service deployment.
- Enterprise identity, RBAC, or an external secrets vault. Internal contracts must permit these later.

## 3. Verified Technical Findings

### 3.1 Harness2

Harness2 uses two recursive levels while model weights remain fixed:

- Task-level recursion performs Propose-Probe-Compose. Editors propose invariant and domain changes, executors probe them on the same task, and a composer uses behavioral contrasts to produce a refined harness.
- Harnessing-level recursion reflects on adopted harnesses and evidence-supported lessons, then carries those learnings into later tasks.

The upstream project exposes system prompt, guardrails, memory, tool guidance, subagents, skills, scripts, and plugins. Its released executors target OpenCode and Codex, and its benchmark integration assumes local harness layouts and benchmark runners.

Relevant sources:

- [Harness2 README](https://github.com/google-research/harness2/blob/main/README.md)
- [Core recursion](https://github.com/google-research/harness2/blob/main/harness2/core/recursion.py)
- [Proposer](https://github.com/google-research/harness2/blob/main/harness2/core/proposer.py)
- [Context and evidence](https://github.com/google-research/harness2/blob/main/harness2/core/context.py)
- [Ledger](https://github.com/google-research/harness2/blob/main/harness2/core/ledger.py)
- [Library and persisted learnings](https://github.com/google-research/harness2/blob/main/harness2/core/library.py)
- [Selection](https://github.com/google-research/harness2/blob/main/harness2/core/selection.py)
- [Harness specification](https://github.com/google-research/harness2/blob/main/harness2/core/spec.py)
- [Executor abstraction](https://github.com/google-research/harness2/blob/main/harness2/substrate/base.py)
- [Experiment and resume guidance](https://github.com/google-research/harness2/blob/main/docs/EXPERIMENTS.md)

### 3.2 Agent Platform

The environment-provided Swagger contract was inspected without exposing its server URL or service key. It proves support for:

- creating, listing, reading, updating, and deleting agent versions;
- executing a specific agent version synchronously or as a job;
- executing versioned artifacts;
- querying artifact execution status by trace identifier;
- managing agent-version parameters;
- managing artifacts and draft saves;
- managing namespaced memories;
- declaring workflow tools inside a workflow manifest.

Agent Platform artifact types include `dta-flow`, `dta-kb`, `dta-memory`, and `dta-records`. A workflow manifest contains flow, tools, info, schema, and secrets. The MVP may modify only the supported, validated representation of:

- `dta-flow` workflow content and orchestration;
- tools declared in the workflow;
- agent-version parameters;
- knowledge-base references/configuration;
- memory and records declarations.

Skills, plugins, guardrails, and subagents are not exposed as independent Agent Platform components in the inspected contract. The MVP must not claim to edit them independently. If instructions or rules are represented inside a validated workflow node, they may be edited as part of the flow while immutable rules remain protected.

### 3.3 Langfuse

The configured instance authenticates successfully and exposes Scores API v3 and legacy trace APIs. Its OpenAPI advertises Observations API v2, but bounded requests returned HTTP 404 during investigation. The collector therefore requires runtime capability negotiation and a tested legacy fallback.

Current official guidance uses:

- Observations API v2 for row-level observations, cursor pagination, selective fields, and reconstruction by `traceId`;
- Scores API v3 for typed score reads;
- bounded time ranges on observation requests;
- grouping observations by trace and parent identifier client-side;
- instance-served OpenAPI for self-hosted compatibility checks.

Relevant sources:

- [Public API](https://langfuse.com/docs/api-and-data-platform/features/public-api)
- [Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk)
- [Deprecated API migration](https://langfuse.com/faq/all/deprecated-api-migration)
- [Trace identifiers](https://langfuse.com/docs/observability/features/trace-ids-and-distributed-tracing)
- [Experiments](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)
- [Compare experiments](https://langfuse.com/docs/evaluation/experiments/compare-experiments)

## 4. Architectural Decision

Use Harness2 through an anti-corruption layer rather than adopting its complete benchmark runtime or independently reimplementing the idea.

Reuse or adapt directly where coupling permits:

- Propose-Probe-Compose control flow;
- evidence ledger concepts and compatible code;
- candidate selection and composition concepts;
- experience reflection and scoped learning library concepts;
- reproducibility, task selection, and resume practices.

Replace or adapt:

- OpenCode/Codex substrates with a Agent Platform executor;
- benchmark-specific task loaders with trace-derived and user-provided cases;
- filesystem harness assumptions with versioned Agent Platform artifacts;
- benchmark judging with a separate evaluation subsystem;
- upstream run storage with the application's transactional persistence.

Every round records both `refinement_engine_version` and the exact `harness2_upstream_version` or commit. Harness2 remains pinned in the dependency lockfile. Upgrades pass contract and characterization tests before adoption.

## 5. System Architecture

The MVP is a modular monolith with four deployable processes from one codebase:

- Web frontend.
- Backend API.
- Background worker.
- SQLite database and local export storage.

The code follows ports and adapters. Core use cases do not import Agent Platform, Langfuse, web framework, database, or LLM provider clients.

### 5.1 Core ports

- `TraceRepository`: query and normalize execution evidence.
- `AgentHarnessRepository`: inspect capabilities and read or create harness versions.
- `CandidateExecutor`: run a baseline or candidate and return correlation references.
- `RefinementEngine`: conduct Propose-Probe-Compose and reflection.
- `EvaluationEngine`: run independent evaluators and recommendation policy.
- `RunRepository`: persist aggregate state, checkpoints, and events.
- `SecretStore`: encrypt, retrieve internally, rotate, and delete integration credentials.
- `ArtifactExporter`: create complete Agent Platform-ready candidates, diffs, and reports.
- `EventPublisher`: publish durable progress events to the frontend.

Initial adapters are `LangfuseTraceRepository`, `AgentPlatformAgentAdapter`, `SqliteRunRepository`, `EncryptedSqliteSecretStore`, and filesystem exporters.

### 5.2 Cohesion and coupling rules

- Each module owns one business capability and exposes an explicit interface.
- Platform payloads are translated at adapter boundaries into internal types.
- Evaluation does not import refinement implementation details.
- The frontend consumes stable API response and event contracts, not database models.
- New agents require configuration and, only when their platform shape differs, an adapter.
- Comments explain decisions, invariants, compatibility handling, and non-obvious algorithms. Comments must not repeat self-explanatory code.

## 6. Round Workflow

1. Validate connection health, credentials, and detected capabilities.
2. Register an immutable baseline harness snapshot and execution configuration.
3. Collect observations with bounded filters, pagination, checkpoints, retry, and deduplication.
4. Reconstruct executions and record absent fields explicitly.
5. Determine whether the sample is sufficient.
6. When insufficient, collect a baseline by running reviewed cases on Agent Platform and waiting a bounded time for matching Langfuse traces.
7. Partition cases into diagnosis/refinement and reserved validation sets, grouping by session and semantic similarity to avoid leakage.
8. Diagnose observed facts, formulate separate causal hypotheses, and attach traceable evidence.
9. Propose small, independent changes only to editable Agent Platform components.
10. Probe baseline and candidates under equivalent model, parameter, tool, and limit conditions.
11. Compose a consolidated candidate from compatible evidence-supported changes.
12. Evaluate the candidate on reserved cases using the external evaluation subsystem.
13. Recommend, reject, or mark the result inconclusive or pending validation.
14. Persist scoped learnings and export the complete candidate, diff, report, and evidence references.

Every change keeps the chain:

`observed problem -> evidence -> hypothesis -> change -> test result`

## 7. Initial Trace Generation

When no usable traces exist, the UI offers a baseline collection flow. Cases may come from:

- manual entry;
- CSV or JSON import;
- historical inputs without complete traces;
- documentation and rules, after human review;
- LLM-generated synthetic cases, clearly labelled as synthetic.

Collection occurs only in a configured test environment with safe, mocked, or explicitly allowlisted tools. Every execution has an idempotency key and round/case correlation identifier. The Agent Platform trace identifier is used to retrieve the corresponding Langfuse data.

If the Agent Platform execution finishes but the trace does not appear within the configured wait budget, the system records collection as incomplete. It does not fabricate a trace or treat the Agent Platform response as complete observability.

Baseline collection does not by itself prove improvement. If there are too few independent reserved cases, the final status is `validation_insufficient`.

## 8. Trace Collection and Reconstruction

Agent trace selection supports identifiers plus filters available in the active Langfuse API, including time range, environment, version, session, tags, and scores. Unsupported filters are disabled in the UI and recorded in capability metadata.

The collector:

- always bounds requests by time;
- follows cursor or page pagination according to the negotiated API;
- checkpoints the last confirmed cursor/page and time window;
- deduplicates by project and observation identifier;
- retries 429 and transient 5xx responses with bounded exponential backoff;
- narrows time windows when API limits require it;
- stores source API version and collection limitations.

The normalizer groups observations by trace, preserves physical parent relations, identifies logical roots where available, and retains:

- inputs and outputs as untrusted data;
- tool calls and parameters;
- errors and status messages;
- model and prompt metadata when present;
- token, cost, and latency data when present;
- session, environment, version, release, and tags when present;
- raw source references and missing-field indicators.

No missing prompt, expected output, cost, or agent version is inferred.

## 9. Diagnosis

Each finding contains:

- stable category code;
- observed fact;
- separate causal hypothesis;
- frequency and sample denominator;
- impact and severity;
- trace and observation identifiers;
- source links where constructible;
- sanitized evidence excerpts;
- confidence and analysis limitations.

The initial taxonomy covers instruction or business-rule violations, omitted or unnecessary tools, invalid tool parameters, unsupported answers, context failures, repetition, cost, latency, integration/authentication/infrastructure failures, and tool failures.

Infrastructure, authentication, and external tool failures must not automatically generate prompt changes. Existing scores are treated as signals until their source, coverage, consistency, and agreement with reviewed examples have been assessed.

## 10. Refinement Engine

### 10.1 Propose

Generate small and independently testable edits. Each proposal identifies the supported Agent Platform component, the evidence and hypothesis, expected behavioral effect, immutable constraints, and rollback representation.

### 10.2 Probe

Run the baseline and each candidate against comparable cases. Use the same model, generation parameters, tool conditions, timeouts, and seeds when platforms expose them. Recorded tool responses may be replayed only when the candidate makes a compatible call; otherwise the case requires a real or simulated tool execution and the report states the limitation.

### 10.3 Compose

Combine only compatible changes. Composition considers behavioral contrasts, critical constraints, and external evaluation signals but does not declare quality improvement itself.

### 10.4 Reflect

Persist adopted and rejected lessons with evidence, scope, source round, and applicability conditions. Learning retrieval is restricted by agent and domain. Reserved cases and their content are never placed in refinement memory.

## 11. Independent Evaluation

External means external to the refinement engine, not external to the backend. The background worker runs evaluation; the frontend configures it and displays results.

Each agent has configurable success criteria combining:

- deterministic checks for format, required rules, sequences, and tool use;
- expert-validated references when available;
- calibrated LLM-as-a-Judge evaluators when appropriate;
- actual task completion, cost, token, and latency measurements;
- human review entered through the UI.

LLM-as-a-Judge is optional, versioned, and calibrated against reviewed examples. It is not the sole authority and cannot compensate for a failed critical rule. Historical agent output is never automatically considered correct.

A candidate is recommended only when:

- all critical constraints pass;
- configured minimum gains are achieved;
- cost and latency limits are respected;
- the reserved sample meets its minimum size;
- candidate executions actually occurred on Agent Platform;
- no blocking regression criterion is met.

The result includes sample size, per-case regressions, aggregate changes, run variability when repeated, and uncertainty. Valid terminal decisions are:

- `recommended`;
- `rejected`;
- `inconclusive`;
- `pending_validation`;
- `validation_insufficient`;
- `stopped_by_limit`;
- `cancelled`;
- `integration_failed`.

## 12. Persistence

SQLite is stored under `APP_DATA_DIR`; exported files are stored under `APP_DATA_DIR/exports/<agent>/<round>/`. Database migrations are versioned.

Primary persisted entities are:

- agents, domains, connections, and detected capabilities;
- immutable harness versions and diffs;
- rounds, stages, durable progress events, and checkpoints;
- cases, similarity groups, and partitions;
- traces, observations, source references, and missing-data records;
- findings, evidence, hypotheses, and proposals;
- executions, attempts, metrics, and correlations;
- evaluator definitions, rubrics, scores, and decisions;
- scoped learnings;
- export metadata, paths, and hashes;
- sanitized audit events.

Every relevant record includes agent and domain scope. Validation partition access is separated from refinement queries. Execution configuration and harness versions become immutable once used.

Large source data is retained only when needed for reproducible evidence. The application retains source identifiers and links while respecting configured retention and export policies.

## 13. Credentials and Security

Users enter Agent Platform and Langfuse connection credentials through the frontend during initial setup or integration registration. The browser sends secrets only to the backend over a protected connection and never stores them in local storage.

For the local MVP:

- connection secrets are encrypted before SQLite persistence;
- the encryption master key comes from `APP_ENCRYPTION_KEY` in the process environment;
- API responses return configured/not-configured state, never plaintext secrets;
- replacing credentials requires a new value;
- deleting a connection deletes encrypted material;
- a `SecretStore` port permits later replacement with Azure Key Vault, Vault, or another managed store.

Development `.env` files may be imported only through an explicit development-only path. They are ignored by Git and never exposed to the frontend.

A central redactor protects logs, errors, events, reports, fixtures, and exports. It removes secrets, authorization headers, tokens, sensitive URLs where configured, and known credential patterns.

Trace content is always untrusted. It is never executed, used as privileged instructions, or interpolated into system-level prompts without strict delimiting and provenance labels.

## 14. Limits, Background Execution, and Recovery

Per-agent and per-round limits cover iterations, calls, input/output tokens, total cost, wall-clock time, per-call timeout, and concurrency. Stop conditions include budget exhaustion, repeated equivalent proposals, no measurable gain, critical regression, cancellation, and integration failure.

The worker provides:

- idempotency by round, case, harness version, evaluator, and attempt;
- a durable checkpoint after every confirmed stage;
- bounded retries only for recoverable failures;
- cooperative cancellation;
- resumable collection and evaluation;
- separate states for failed execution, missing trace, failed evaluation, and poor agent output.

The frontend receives server-sent progress events backed by persisted event records. Reconnecting clients replay events after their last event identifier. No fictitious percentage is calculated.

## 15. Internationalization and Logs

The application supports:

- Brazilian Portuguese (`pt-BR`) as the default;
- English (`en`);
- Spanish (`es`).

Frontend labels, validations, operational progress, errors, backend and worker log messages, human-facing reports, exports, finding labels, and states are localized. Browser language provides the initial preference, and users can change it without restarting a round.

Structured events store a stable language-neutral code and typed parameters. Human-readable messages are rendered in the requested locale. Persisted business facts do not depend on translated prose.

Technical names such as Agent Platform, Langfuse, HTTP, `trace_id`, and harness remain unchanged. Original trace, prompt, and response content is not translated automatically because translation would alter evidence. Any optional translation must be labelled and preserve the original.

Logs use structured fields with stable event codes. Human-readable messages are localized. External exception messages are sanitized and mapped to localized application messages; a sanitized technical detail may be retained separately. Tests prevent untranslated message keys and verify fallback to `pt-BR`.

## 16. Frontend Experience

The interface has three primary areas:

- Agents: connections, agent selection, editable capabilities, baseline version, immutable rules, and success criteria.
- Rounds: setup, sample review, real progress, cancellation, history, and resume.
- Results: findings, evidence, before/after comparison, regressions, limitations, and exports.

Agent registration is a guided flow:

1. Register and test a Langfuse connection.
2. Register and test a Agent Platform connection.
3. Select project, agent, and baseline version.
4. Detect capabilities.
5. Define domain, immutable rules, and evaluation criteria.
6. Review and save.

Round setup collects objective, period, filters, cases, budgets, and recommendation thresholds. A sample review shows diagnosis/refinement and reserved validation counts. Users may remove unsuitable cases, but refinement cannot inspect reserved content.

Round progress uses real stages and counters, for example collecting executions, identifying problems, preparing improvements, testing versions, and comparing results. Users can cancel, leave, return, inspect sanitized errors, and review consumed limits.

The result screen leads with recommendation, confidence, critical violations, regressions, sample size, cost, and latency. Every proposed change exposes the complete evidence chain. The diff has a plain-language view and a technical Agent Platform artifact view.

Available final actions are export candidate, export report, request technical review, reject with reason, and start another round. There is no production publication action.

## 17. API and Event Contracts

Public backend contracts are versioned. Core resources include connections, agents, cases, rounds, events, findings, comparisons, credentials status, and exports. Mutation requests use idempotency keys where retries are possible.

Progress events include:

- stable event identifier and code;
- round and stage identifiers;
- timestamp;
- localized message key parameters;
- real counters and consumed limits;
- severity;
- recoverable flag;
- sanitized technical context.

Database models are never serialized directly. JSON schemas and generated client types prevent drift between backend and frontend.

## 18. Testing Strategy

### 18.1 Unit and property tests

Cover domain invariants, limits, recommendation policy, partition isolation, deduplication, tree reconstruction, redaction, encryption, localization, and state transitions.

### 18.2 Contract tests

Version contracts for:

- Agent Platform OpenAPI operations and used schemas;
- Langfuse capability negotiation, modern and legacy reads, scores, and pagination;
- Harness2 adapter inputs, outputs, and stop behavior;
- LLM provider adapters;
- `SecretStore` and persistence ports;
- backend REST and progress event schemas;
- Agent Platform candidate export and report formats.

Sanitized fixtures exercise required and optional fields, new unknown fields, missing fields, enum changes, pagination, rate limits, and error shapes. CI compares sanitized OpenAPI snapshots from test instances. Compatible additions produce reviewable changes; removed used operations or incompatible type changes fail the gate.

Harness2 characterization tests run a deterministic corpus and compare proposal shape, probe count/order, consumed evidence, composition, persisted learnings, and stop criteria. Intentional semantic changes require a new `refinement_engine_version` and reviewed expectations.

### 18.3 Integration tests

Use local fake servers implementing contract schemas for required CI coverage. Real Agent Platform and Langfuse smoke tests are opt-in, bounded, use test environments, and avoid external side effects.

### 18.4 End-to-end tests

Hermetic browser E2E covers:

- registering and testing credentials;
- registering an agent and detecting capabilities;
- paginated collection and deduplication;
- baseline generation when traces are absent;
- case partitioning;
- a complete round and candidate export;
- cancellation and resume after restart;
- critical-rule rejection;
- missing trace and integration failures;
- history persistence;
- switching among `pt-BR`, `en`, and `es`.

### 18.5 Interface tests

Playwright verifies keyboard navigation, focus, accessibility, empty/loading/success/error/cancelled states, real event updates, desktop and mobile layouts, long translated text, secret masking, comparison views, downloads, and returning to active rounds.

Visual regression screenshots cover primary screens in all three locales. Snapshot changes require review rather than automatic replacement. Automated accessibility checks complement keyboard and screen-reader-oriented assertions.

### 18.6 Dependency update gates

All dependencies are pinned in lockfiles. An isolated update runs:

1. unit and property tests;
2. contract and characterization tests;
3. database migration tests against a copied database;
4. integration tests;
5. hermetic E2E tests;
6. interface, visual, and accessibility tests;
7. secret scanning and dependency security checks;
8. comparison of the deterministic demonstration.

Compilation alone never approves an update.

## 19. Demonstration

The delivered demonstration performs one small real round:

1. Register Agent Platform and Langfuse connections through the UI.
2. Register an agent and inspect editable capabilities.
3. Collect existing traces or generate a baseline.
4. Diagnose a bounded sample.
5. Propose at least one justified change.
6. Execute baseline and candidate on Agent Platform.
7. Evaluate reserved cases.
8. Display an evidence-based decision or explicit validation blocker.
9. Export the complete candidate and report.

All real integration work uses strict low limits. No simulated output is presented as a real result.

## 20. Acceptance Criteria

The MVP is accepted when:

- a user can complete the demonstration workflow from the frontend;
- worker progress is real, durable, cancellable, and resumable;
- agent and domain data remain isolated;
- reserved cases cannot leak into refinement or learning memory;
- credentials are encrypted and never returned or logged;
- trace collection handles pagination, limits, missing fields, and supported fallback;
- every finding has traceable evidence and separates fact from hypothesis;
- every change preserves the evidence-to-result chain;
- no improvement is claimed without real candidate execution and sufficient reserved validation;
- critical rules remain independent of aggregate scores;
- the complete Agent Platform candidate and a clear diff are exportable;
- logs and user-facing content work in `pt-BR`, `en`, and `es` with fallback;
- contract, characterization, hermetic E2E, interface, visual, and accessibility tests pass;
- a real opt-in integration smoke test verifies Agent Platform and Langfuse connectivity;
- installation, `.env.example`, example agent configuration, decisions, limitations, and source references are documented.

## 21. Known Limitations and Evolution

- The investigated Langfuse instance requires a legacy read fallback despite advertising Observations v2. The application reports this capability mismatch and can remove the fallback only after a verified instance upgrade.
- SQLite and local encrypted secrets are appropriate for a local MVP, not a shared production deployment. Ports permit PostgreSQL, object storage, and managed secret stores later.
- LLM judges remain probabilistic and require calibration; deterministic and human signals retain independent authority.
- Harness2 upstream changes are not adopted automatically. The adapter, characterization tests, pinned versions, and recorded engine metadata protect reproducibility.
- Agent Platform components not represented by its verified contract remain read-only or unsupported until a new contract proves otherwise.
