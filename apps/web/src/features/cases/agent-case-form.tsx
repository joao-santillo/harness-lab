import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MessageKey } from "../../i18n/messages.js";

interface AgentCaseFormProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
  connectionsRefreshKey?: number;
  initialAgentId?: string;
  initialStep?: 1 | 2 | 3;
  onAgentSelected?(agentId: string, step: 1 | 2 | 3): void;
  onStepChange?(agentId: string, step: 1 | 2 | 3): void;
}

interface CaseImportInput {
  readonly id: string;
  readonly sessionId: string;
  readonly similarityGroup: string;
  readonly content: string;
  readonly syntheticLabel?: "SYNTHETIC";
}

interface ConnectionSummary {
  readonly id: string;
  readonly kind: "langfuse" | "agent-platform";
  readonly name: string;
}

interface AgentSummary {
  readonly id: string;
  readonly domainId: string;
  readonly name: string;
  readonly createdAt?: string;
}

interface CaseSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly similarityGroup: string;
  readonly content: string;
  readonly source?: string;
  readonly createdAt?: string;
}

type LangfuseFilterField = "traceName" | "environment" | "tags" | "userId" | "sessionId";

function parseCaseBatch(value: string): readonly CaseImportInput[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 40) return null;
    const valid = parsed.every((item) => item !== null && typeof item === "object" &&
      ["id", "sessionId", "similarityGroup", "content"].every((field) => {
        const value = (item as Record<string, unknown>)[field];
        return typeof value === "string" && value.trim().length > 0;
      }));
    return valid ? parsed as CaseImportInput[] : null;
  } catch {
    return null;
  }
}

export function AgentCaseForm({ t, request = fetch, connectionsRefreshKey = 0, initialAgentId, initialStep = 1, onAgentSelected, onStepChange }: AgentCaseFormProps) {
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsStatus, setAgentsStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [casesStatus, setCasesStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [agentReady, setAgentReady] = useState(false);
  const [agentRouteMissing, setAgentRouteMissing] = useState(false);
  const [scope, setScope] = useState<{ agentId: string; domainId: string } | null>(null);
  const [agentStatus, setAgentStatus] = useState<"idle" | "saving" | "created" | "conflict" | "failed">("idle");
  const [caseStatus, setCaseStatus] = useState<"idle" | "importing" | "invalid" | "imported" | "conflict" | "failed" | "auth-failed" | "unavailable">("idle");
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; limitations: string[] } | null>(null);
  const [caseFormat, setCaseFormat] = useState<"json" | "csv">("json");
  const [caseSource, setCaseSource] = useState<"manual" | "json" | "historical" | "synthetic" | "langfuse">("langfuse");
  const [langfuseFilterField, setLangfuseFilterField] = useState<LangfuseFilterField | "">("");
  const [langfuseFilterValue, setLangfuseFilterValue] = useState("");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionsStatus, setConnectionsStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [caseFilter, setCaseFilter] = useState("");
  const casesRequestId = useRef(0);

  function readAgentItems(body: unknown): AgentSummary[] {
    if (body === null || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) return [];
    return (body as { items: unknown[] }).items.filter((item): item is AgentSummary => item !== null && typeof item === "object"
      && typeof (item as Record<string, unknown>).id === "string"
      && typeof (item as Record<string, unknown>).domainId === "string"
      && typeof (item as Record<string, unknown>).name === "string");
  }

  function readCaseItems(body: unknown): CaseSummary[] {
    if (body === null || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) return [];
    return (body as { items: unknown[] }).items.filter((item): item is CaseSummary => item !== null && typeof item === "object"
      && typeof (item as Record<string, unknown>).id === "string"
      && typeof (item as Record<string, unknown>).sessionId === "string"
      && typeof (item as Record<string, unknown>).similarityGroup === "string"
      && typeof (item as Record<string, unknown>).content === "string");
  }

  async function loadAgents(): Promise<AgentSummary[]> {
    setAgentsStatus("loading");
    try {
      const response = await request("/api/v1/agents");
      if (!response.ok) throw new Error("AGENTS_LOAD_FAILED");
      const items = readAgentItems(await response.json());
      setAgents(items);
      setAgentsStatus("ready");
      return items;
    } catch {
      setAgentsStatus("failed");
      return [];
    }
  }

  async function loadCases(agent: AgentSummary) {
    const requestId = ++casesRequestId.current;
    setCasesStatus("loading");
    try {
      const response = await request(`/api/v1/cases?agentId=${encodeURIComponent(agent.id)}&domainId=${encodeURIComponent(agent.domainId)}`);
      if (!response.ok) throw new Error("CASES_LOAD_FAILED");
      const items = readCaseItems(await response.json());
      if (requestId !== casesRequestId.current) return;
      setCases(items);
      setCasesStatus("ready");
    } catch {
      if (requestId !== casesRequestId.current) return;
      setCasesStatus("failed");
    }
  }

  useEffect(() => {
    void loadAgents();
  }, [request]);

  useEffect(() => {
    if (initialAgentId === undefined) {
      setAgentRouteMissing(false);
      return;
    }
    if (agentsStatus !== "ready") return;
    const agent = agents.find(({ id }) => id === initialAgentId);
    if (agent === undefined) {
      casesRequestId.current += 1;
      setAgentRouteMissing(true);
      return;
    }
    setAgentRouteMissing(false);
    if (selectedAgentId === agent.id) {
      setStep(initialStep);
      return;
    }
    setSelectedAgentId(agent.id);
    setScope({ agentId: agent.id, domainId: agent.domainId });
    setAgentReady(true);
    setAgentStatus("conflict");
    setShowCreateAgent(false);
    setStep(initialStep);
    setCases([]);
    setCaseStatus("idle");
    setImportResult(null);
    void loadCases(agent);
  }, [agents, agentsStatus, initialAgentId, initialStep, selectedAgentId]);

  function selectAgent(agent: AgentSummary, notifyRoute = true) {
    setSelectedAgentId(agent.id);
    setScope({ agentId: agent.id, domainId: agent.domainId });
    setAgentReady(true);
    setAgentStatus("conflict");
    setShowCreateAgent(false);
    setCases([]);
    setCasesStatus("idle");
    setCaseStatus("idle");
    setImportResult(null);
    setStep(2);
    void loadCases(agent);
    if (notifyRoute) onAgentSelected?.(agent.id, 2);
  }

  useEffect(() => {
    if (caseSource !== "langfuse") return;
    let active = true;
    setConnectionsStatus("loading");
    request("/api/v1/connections")
      .then(async (response) => {
        if (!response.ok) throw new Error("CONNECTIONS_LOAD_FAILED");
        const body: unknown = await response.json();
        const rawItems = body !== null && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
          ? (body as { items: unknown[] }).items : [];
        const valid = rawItems.filter((item): item is ConnectionSummary => item !== null && typeof item === "object"
          && typeof (item as Record<string, unknown>).id === "string"
          && (item as Record<string, unknown>).kind === "langfuse"
          && typeof (item as Record<string, unknown>).name === "string");
        if (active) {
          setConnections(valid);
          setConnectionsStatus("ready");
        }
      })
      .catch(() => {
        if (active) setConnectionsStatus("failed");
      });
    return () => { active = false; };
  }, [caseSource, connectionsRefreshKey, request]);

  function goToStep(nextStep: 1 | 2 | 3) {
    setStep(nextStep);
    if (scope !== null) onStepChange?.(scope.agentId, nextStep);
  }

  function invalidateAgentScope() {
    casesRequestId.current += 1;
    setAgentReady(false);
    setScope(null);
    setAgentStatus("idle");
    setCaseStatus("idle");
    setSelectedAgentId("");
    setCases([]);
    setCasesStatus("idle");
    setImportResult(null);
  }

  async function createAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("agentId") ?? "").trim();
    const domainId = String(form.get("domainId") ?? "").trim();
    const name = String(form.get("agentName") ?? "").trim();
    if (!id || !domainId || !name) {
      setAgentStatus("failed");
      return;
    }
    setAgentStatus("saving");
    setShowCreateAgent(true);
    try {
      const response = await request("/api/v1/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, domainId, name }),
      });
      if (response.ok) {
        setScope({ agentId: id, domainId });
        setAgentReady(true);
        setAgentStatus("created");
        setSelectedAgentId(id);
        setStep(2);
        await loadAgents();
        onAgentSelected?.(id, 2);
      } else if (response.status === 409) {
        const existingAgents = await loadAgents();
        const existingAgent = existingAgents.find((agent) => agent.id === id && agent.domainId === domainId);
        if (existingAgent === undefined) {
          setAgentStatus("failed");
          return;
        }
        setScope({ agentId: existingAgent.id, domainId: existingAgent.domainId });
        setAgentReady(true);
        setAgentStatus("conflict");
        setSelectedAgentId(existingAgent.id);
        setStep(2);
        onAgentSelected?.(existingAgent.id, 2);
      } else {
        setAgentStatus("failed");
      }
    } catch {
      setAgentStatus("failed");
    }
  }

  async function importCases(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const csv = String(form.get("casesCsv") ?? "");
    const cases = parseCaseBatch(String(form.get("casesJson") ?? ""));
    const sourceReference = String(form.get("sourceReference") ?? "").trim();
    const syntheticLabel = String(form.get("syntheticLabel") ?? "").trim();
    const connectionId = String(form.get("connectionId") ?? "").trim();
    const filterValue = String(form.get("langfuseFilterValue") ?? "").trim();
    const fromStartTime = String(form.get("fromStartTime") ?? "");
    const toStartTime = String(form.get("toStartTime") ?? "");
    const limit = Number(form.get("limit") ?? "");
    const validDates = fromStartTime !== "" && toStartTime !== "" && Number.isFinite(Date.parse(fromStartTime))
      && Number.isFinite(Date.parse(toStartTime)) && Date.parse(fromStartTime) < Date.parse(toStartTime);
    if (caseFormat === "json" && caseSource === "langfuse") {
      if (!agentReady || scope === null || !connectionId || !validDates || !Number.isInteger(limit) || limit < 1 || limit > 40
        || (langfuseFilterField !== "" && (filterValue.length === 0 || filterValue.length > 200))) {
        setCaseStatus("invalid");
        return;
      }
      setCaseStatus("importing");
      setImportResult(null);
      try {
        const response = await request("/api/v1/cases/import-langfuse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...scope,
            connectionId,
            fromStartTime: new Date(fromStartTime).toISOString(),
            toStartTime: new Date(toStartTime).toISOString(),
            limit,
            ...(langfuseFilterField === "" ? {} : { filter: { field: langfuseFilterField, value: filterValue } }),
          }),
        });
        if (response.ok) {
          const result = await response.json() as { imported?: unknown; skipped?: unknown; limitations?: unknown };
          setImportResult({
            imported: typeof result.imported === "number" ? result.imported : 0,
            skipped: typeof result.skipped === "number" ? result.skipped : 0,
            limitations: Array.isArray(result.limitations) ? result.limitations.filter((item): item is string => typeof item === "string") : [],
          });
          setCaseStatus("imported");
          const selectedAgent = agents.find((agent) => agent.id === scope.agentId);
          if (selectedAgent) await loadCases(selectedAgent);
        } else if (response.status === 422) {
          setCaseStatus("auth-failed");
        } else if (response.status === 503) {
          setCaseStatus("unavailable");
        } else {
          setCaseStatus("failed");
        }
      } catch {
        setCaseStatus("failed");
      }
      return;
    }
    if (!agentReady || scope === null || (caseFormat === "csv" ? csv.trim().length === 0 || csv.length > 250_000 : cases === null) ||
      (caseFormat === "json" && caseSource === "historical" && sourceReference.length === 0) ||
      (caseFormat === "json" && caseSource === "synthetic" && syntheticLabel !== "SYNTHETIC")) {
      setCaseStatus("invalid");
      return;
    }
    setCaseStatus("importing");
    try {
      const response = await request(caseFormat === "csv" ? "/api/v1/cases/import-csv" : "/api/v1/cases/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(caseFormat === "csv" ? { ...scope, csv } : {
          ...scope, source: caseSource,
          ...(caseSource === "historical" ? { sourceReference } : {}),
          cases: caseSource === "synthetic" ? cases!.map((item) => ({ ...item, syntheticLabel: "SYNTHETIC" })) : cases,
        }),
      });
      if (response.ok) {
        setCaseStatus("imported");
        const selectedAgent = agents.find((agent) => agent.id === scope.agentId);
        if (selectedAgent) await loadCases(selectedAgent);
      } else if (response.status === 409) {
        setCaseStatus("conflict");
      } else {
        setCaseStatus("failed");
      }
    } catch {
      setCaseStatus("failed");
    }
  }

  const activeAgent = scope ? agents.find((agent) => agent.id === scope.agentId) ?? null : null;
  const canLeaveAgentStep = agentReady && scope !== null;
  const normalizedFilter = caseFilter.trim().toLowerCase();
  const filteredCases = normalizedFilter.length === 0
    ? cases
    : cases.filter((item) => [item.content, item.id, item.sessionId, item.similarityGroup, item.source ?? ""]
      .some((field) => field.toLowerCase().includes(normalizedFilter)));

  return (
    <section className="case-setup wizard" aria-labelledby="case-setup-title">
      <div className="wizard-intro">
        <p className="eyebrow">{t("caseSetupEyebrow")}</p>
        <h2 id="case-setup-title">{t("caseSetupTitle")}</h2>
        <p>{t("caseSetupDescription")}</p>
      </div>
      {agentRouteMissing && <p className="notice error" role="alert">{t("agentRouteNotFound")}</p>}
      <ol className="workflow-steps" aria-label={t("workflowLabel")}>
        {[1, 2, 3].map((item) => {
          const reachable = item === 1 || canLeaveAgentStep;
          return (
            <li className={step === item ? "current" : step > item ? "complete" : ""} key={item}>
              <button
                type="button"
                className="workflow-step-button"
                aria-current={step === item ? "step" : undefined}
                disabled={!reachable}
                onClick={() => goToStep(item as 1 | 2 | 3)}
              >
                <span>{item}</span>
                {t(item === 1 ? "workflowStepAgent" : item === 2 ? "workflowStepImport" : "workflowStepCases")}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="agent-step-grid" hidden={step !== 1}>
        <section className="setup-card agent-catalog" aria-labelledby="agent-catalog-title">
          <span className="setup-card-label">{t("agentCatalogLabel")}</span>
          <h3 id="agent-catalog-title">{t("agentCatalogTitle")}</h3>
          <p className="card-help">{t("agentCatalogHelp")}</p>
          {agentsStatus === "loading" && <p className="notice" role="status">{t("loadingAgents")}</p>}
          {agentsStatus === "failed" && <p className="notice error" role="alert">{t("agentsLoadFailed")}</p>}
          {agentsStatus === "ready" && agents.length === 0 && <div className="empty-state"><strong>{t("emptyAgents")}</strong><span>{t("emptyAgentsHint")}</span></div>}
          {agents.length > 0 && <ul className="agent-list">
            {agents.map((agent) => <li className={selectedAgentId === agent.id ? "selected" : ""} key={agent.id}>
              <button type="button" onClick={() => selectAgent(agent)}>
                <strong>{agent.name}</strong><span>{agent.id} · {agent.domainId}</span>
              </button>
            </li>)}
          </ul>}
          <div className="card-actions">
            <button className="secondary-button" type="button" onClick={() => void loadAgents()} disabled={agentsStatus === "loading"}>{t("refreshAgents")}</button>
            {!showCreateAgent && <button className="secondary-button" type="button" onClick={() => { invalidateAgentScope(); setShowCreateAgent(true); }}>{t("showCreateAgent")}</button>}
          </div>
        </section>

        <form className="setup-card agent-form" onSubmit={createAgent} hidden={!showCreateAgent && selectedAgentId !== ""}>
          <span className="setup-card-label">{t("agentStepLabel")}</span>
          <h3>{t("createAgentTitle")}</h3>
          <p className="card-help">{t("createAgentHelp")}</p>
          <label>{t("agentId")}<input name="agentId" required autoComplete="off" onChange={invalidateAgentScope} /></label>
          <label>{t("domainId")}<input name="domainId" required autoComplete="off" onChange={invalidateAgentScope} /></label>
          <label>{t("agentName")}<input name="agentName" required onChange={invalidateAgentScope} /></label>
          {agentStatus === "created" && <p className="notice success" role="status">{t("agentCreated")}</p>}
          {agentStatus === "conflict" && <p className="notice" role="status">{t("agentExists")}</p>}
          {agentStatus === "failed" && <p className="notice error" role="alert">{t("agentSaveFailed")}</p>}
          <button type="submit" disabled={agentStatus === "saving"}>{agentStatus === "saving" ? t("savingAgent") : t("createAgent")}</button>
        </form>
      </div>

      <form className="setup-card import-card" onSubmit={importCases} hidden={step !== 2}>
        <span className="setup-card-label">{t("casesStepLabel")}</span>
        <h3>{t(caseFormat === "csv" ? "importCasesCsvTitle" : "importCasesTitle")}</h3>
        <p className="card-help">{t("importStepHelp")}</p>
        <div className="import-grid">
          <div className="import-options">
            <label>{t("caseFormat")}<select value={caseFormat} onChange={(event) => { setCaseFormat(event.target.value as typeof caseFormat); setCaseStatus("idle"); }}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select></label>
            {caseFormat === "json" && <label>{t("caseSource")}<select value={caseSource} onChange={(event) => { setCaseSource(event.target.value as typeof caseSource); setCaseStatus("idle"); }}>
              <option value="langfuse">{t("sourceLangfuse")}</option>
              <option value="json">{t("sourceJson")}</option>
              <option value="manual">{t("sourceManual")}</option>
              <option value="historical">{t("sourceHistorical")}</option>
              <option value="synthetic">{t("sourceSynthetic")}</option>
            </select></label>}
            {caseFormat === "json" && caseSource === "langfuse" && <>
              <label>{t("langfuseConnection")}<select name="connectionId" required disabled={connectionsStatus === "loading"}>
                <option value="">{connectionsStatus === "loading" ? t("loadingConnections") : t("selectLangfuseConnection")}</option>
                {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
              </select></label>
              {connectionsStatus === "failed" && <p className="notice error" role="alert">{t("connectionsLoadFailed")}</p>}
              {connectionsStatus === "ready" && connections.length === 0 && <p className="notice" role="status">{t("noLangfuseConnections")}</p>}
              <div className="import-field-row">
                <label>{t("fromStartTime")}<input name="fromStartTime" type="datetime-local" required /></label>
                <label>{t("toStartTime")}<input name="toStartTime" type="datetime-local" required /></label>
              </div>
              <div className="import-field-row">
                <label>{t("langfuseFilterField")}<select name="langfuseFilterField" value={langfuseFilterField} onChange={(event) => {
                  setLangfuseFilterField(event.target.value as LangfuseFilterField | "");
                  setLangfuseFilterValue("");
                }}>
                  <option value="">{t("langfuseNoFilter")}</option>
                  <option value="traceName">{t("langfuseFilterTraceName")}</option>
                  <option value="environment">{t("langfuseFilterEnvironment")}</option>
                  <option value="tags">{t("langfuseFilterTag")}</option>
                  <option value="userId">{t("langfuseFilterUserId")}</option>
                  <option value="sessionId">{t("langfuseFilterSessionId")}</option>
                </select></label>
                <label>{t("langfuseFilterValue")}<input name="langfuseFilterValue" value={langfuseFilterValue}
                  onChange={(event) => setLangfuseFilterValue(event.target.value)} maxLength={200}
                  disabled={langfuseFilterField === ""} required={langfuseFilterField !== ""} /></label>
              </div>
              <p className="field-hint">{t("langfuseFilterHint")}</p>
              <div className="import-field-row">
                <label>{t("importLimit")}<input name="limit" type="number" min={1} max={40} defaultValue={20} required /></label>
                <label>{t("caseKeywords")}<input value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)} placeholder={t("caseKeywordsPlaceholder")} /></label>
              </div>
              <p className="field-hint">{t("caseKeywordsHint")}</p>
            </>}
            {caseFormat === "json" && caseSource === "historical" && <label>{t("sourceReference")}<input name="sourceReference" required /></label>}
            {caseFormat === "json" && caseSource === "synthetic" && <label>{t("syntheticLabel")}<input name="syntheticLabel" required placeholder="SYNTHETIC" /></label>}
          </div>
          {caseFormat === "json" && caseSource !== "langfuse"
            ? <label className="import-payload">{t("casesJson")}<textarea name="casesJson" rows={10} required placeholder={t("casesJsonPlaceholder")} /></label>
            : caseFormat === "csv" && <label className="import-payload">{t("casesCsv")}<textarea name="casesCsv" rows={10} required placeholder={t("casesCsvPlaceholder")} /></label>}
        </div>
        {caseStatus === "invalid" && <p className="notice error" role="alert">{t("caseImportInvalid")}</p>}
        {caseStatus === "imported" && <p className="notice success" role="status">{importResult === null ? t("casesImported") : t("langfuseImportSuccess").replace("{imported}", String(importResult.imported)).replace("{skipped}", String(importResult.skipped))}</p>}
        {importResult?.limitations.map((limitation) => <p className="notice" role="status" key={limitation}>{limitation}</p>)}
        {caseStatus === "conflict" && <p className="notice error" role="alert">{t("caseConflict")}</p>}
        {caseStatus === "auth-failed" && <p className="notice error" role="alert">{t("langfuseAuthFailed")}</p>}
        {caseStatus === "unavailable" && <p className="notice error" role="alert">{t("langfuseUnavailable")}</p>}
        {caseStatus === "failed" && <p className="notice error" role="alert">{t("caseImportFailed")}</p>}
        {caseStatus === "importing" && <p className="notice" role="status">{t("importingCases")}</p>}
        <div className="import-actions">
          <button type="submit" disabled={!agentReady || caseStatus === "importing"}>{t("importCases")}</button>
          {caseStatus === "imported" && <button type="button" className="secondary-button" onClick={() => goToStep(3)}>{t("reviewCases")}</button>}
        </div>
      </form>

      {step === 3 && (
        <section className="setup-card cases-browser" aria-labelledby="cases-browser-title">
          <div className="cases-browser-heading">
            <div>
              <span className="setup-card-label">{t("casesBrowserLabel")}</span>
              <h3 id="cases-browser-title">{t("casesBrowserTitle")}</h3>
              {scope && <p className="cases-scope-note">{t("casesScopeNote").replace("{agent}", scope.agentId).replace("{domain}", scope.domainId)}</p>}
            </div>
            {scope && <button className="secondary-button" type="button" onClick={() => { const agent = agents.find((item) => item.id === scope.agentId); if (agent) void loadCases(agent); }} disabled={casesStatus === "loading"}>{t("refreshCases")}</button>}
          </div>
          <p className="card-help">{t("reviewStepHelp")}</p>
          {!scope && <div className="empty-state"><strong>{t("selectAgentFirst")}</strong><span>{t("selectAgentFirstHint")}</span></div>}
          {scope && casesStatus === "loading" && <p className="notice" role="status">{t("loadingCases")}</p>}
          {scope && casesStatus === "failed" && <p className="notice error" role="alert">{t("casesLoadFailed")}</p>}
          {scope && casesStatus === "ready" && cases.length === 0 && <div className="empty-state"><strong>{t("emptyCases")}</strong><span>{t("emptyCasesHint")}</span></div>}
          {cases.length > 0 && <>
            <div className="cases-toolbar">
              <label className="cases-search">{t("caseSearchLabel")}<input value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)} placeholder={t("caseSearchPlaceholder")} type="search" /></label>
              <span className="cases-count">{t("casesCount").replace("{shown}", String(filteredCases.length)).replace("{total}", String(cases.length))}</span>
            </div>
            {filteredCases.length === 0
              ? <div className="empty-state"><strong>{t("noCasesMatch")}</strong><span>{t("noCasesMatchHint")}</span></div>
              : <ul className="case-list">{filteredCases.map((item) => (
                <li key={item.id}>
                  <div className="case-card-head">
                    <span className={`case-source case-source-${(item.source ?? "unknown").toLowerCase()}`}>{item.source ?? t("sourceUnknown")}</span>
                    <code className="case-id">{item.id}</code>
                  </div>
                  <p className="case-content">{item.content}</p>
                  <dl className="case-meta">
                    <div><dt>{t("caseSessionLabel")}</dt><dd>{item.sessionId}</dd></div>
                    <div><dt>{t("caseGroupLabel")}</dt><dd>{item.similarityGroup}</dd></div>
                  </dl>
                </li>
              ))}</ul>}
          </>}
        </section>
      )}

      <div className="wizard-nav">
        <button type="button" className="secondary-button" onClick={() => goToStep((currentStep => currentStep > 1 ? (currentStep - 1) as 1 | 2 | 3 : currentStep)(step))} disabled={step === 1}>{t("wizardBack")}</button>
        <button type="button" onClick={() => goToStep((currentStep => currentStep < 3 ? (currentStep + 1) as 1 | 2 | 3 : currentStep)(step))} disabled={step === 3 || !canLeaveAgentStep}>{t("wizardNext")}</button>
      </div>
    </section>
  );
}