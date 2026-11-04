import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { MessageKey } from "../../i18n/messages.js";
import { useRoundEvents, type EventSourceFactory, type RoundProgressEvent } from "./use-round-events.js";

interface AgentItem { readonly id: string; readonly domainId: string; readonly name: string; }
interface RoundItem {
  readonly id: string;
  readonly agentId: string;
  readonly domainId: string;
  readonly objective: string;
  readonly state: string;
  readonly createdAt: string;
}
interface RoundsDashboardProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
  eventSourceFactory?: EventSourceFactory;
  initialActiveRoundId?: string;
  onRoundSelect?(roundId: string): void;
  onPrepareCases?(agentId: string): void;
}

const eventSourceFactory: EventSourceFactory = (url) => new EventSource(url);
const terminalStates = new Set(["recommended", "rejected", "inconclusive", "pending_validation", "validation_insufficient", "stopped_by_limit", "cancelled", "integration_failed"]);

function isRoundItem(value: unknown): value is RoundItem {
  if (typeof value !== "object" || value === null) return false;
  const round = value as Record<string, unknown>;
  return typeof round.id === "string" && typeof round.agentId === "string" &&
    typeof round.domainId === "string" && typeof round.objective === "string" &&
    typeof round.state === "string" && typeof round.createdAt === "string";
}

export function RoundsDashboard({ t, request = fetch, eventSourceFactory: makeEventSource = eventSourceFactory, initialActiveRoundId, onRoundSelect, onPrepareCases }: RoundsDashboardProps) {
  const [agents, setAgents] = useState<readonly AgentItem[]>([]);
  const [rounds, setRounds] = useState<readonly RoundItem[]>([]);
  const [agentId, setAgentId] = useState("");
  const [caseCount, setCaseCount] = useState<number | null>(null);
  const [caseCountStatus, setCaseCountStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [objective, setObjective] = useState("");
  const [activeRoundId, setActiveRoundId] = useState<string | undefined>(initialActiveRoundId);
  const [latestProgress, setLatestProgress] = useState<{ roundId: string; state: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"load" | "create" | "not-found" | "cases" | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRequestedFor, setCancelRequestedFor] = useState<string | null>(null);
  const [cancelFailed, setCancelFailed] = useState(false);
  const caseLookupId = useRef(0);
  const latestProgressByRound = useRef(new Map<string, RoundProgressEvent>());
  const activeRound = rounds.find(({ id }) => id === activeRoundId);
  const streamRoundId = activeRound === undefined || terminalStates.has(activeRound.state) ? undefined : activeRoundId;
  const onProgress = useCallback((event: RoundProgressEvent) => {
    const previous = latestProgressByRound.current.get(event.roundId);
    if (previous !== undefined && event.sequence <= previous.sequence) return;
    latestProgressByRound.current.set(event.roundId, event);
    setRounds((previous) => previous.map((round) => round.id === event.roundId ? { ...round, state: event.state } : round));
    setLatestProgress({ roundId: event.roundId, state: event.state });
  }, []);
  const streamState = useRoundEvents(streamRoundId, makeEventSource, onProgress);

  useEffect(() => { setActiveRoundId(initialActiveRoundId); }, [initialActiveRoundId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [agentsResponse, roundsResponse] = await Promise.all([
        request("/api/v1/agents"),
        request("/api/v1/rounds"),
      ]);
      if (!agentsResponse.ok || !roundsResponse.ok) throw new Error("ROUND_LIST_FAILED");
      const [agentBody, roundBody] = await Promise.all([agentsResponse.json(), roundsResponse.json()]) as [
        { items: AgentItem[] }, { items: RoundItem[] },
      ];
      let nextRounds = roundBody.items;
      if (initialActiveRoundId !== undefined && !nextRounds.some(({ id }) => id === initialActiveRoundId)) {
        const selectedResponse = await request(`/api/v1/rounds/${encodeURIComponent(initialActiveRoundId)}`);
        if (selectedResponse.ok) {
          const selectedRound: unknown = await selectedResponse.json();
          if (isRoundItem(selectedRound)) nextRounds = [selectedRound, ...nextRounds];
          else setError("load");
        } else if (selectedResponse.status === 404) {
          setError("not-found");
        }
      }
      setAgents(agentBody.items);
      setRounds(nextRounds.map((round) => {
        const progress = latestProgressByRound.current.get(round.id);
        return progress === undefined ? round : { ...round, state: progress.state };
      }));
    } catch {
      setError("load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [initialActiveRoundId, request]);

  async function loadCaseCount(agent: AgentItem): Promise<number | null> {
    const lookupId = ++caseLookupId.current;
    setCaseCountStatus("loading");
    setCaseCount(null);
    try {
      const response = await request(`/api/v1/cases?agentId=${encodeURIComponent(agent.id)}&domainId=${encodeURIComponent(agent.domainId)}`);
      if (!response.ok) throw new Error("ROUND_CASES_LOAD_FAILED");
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || !Array.isArray((body as { items?: unknown }).items)) {
        throw new Error("ROUND_CASES_RESPONSE_INVALID");
      }
      const count = (body as { items: unknown[] }).items.length;
      if (lookupId !== caseLookupId.current) return null;
      setCaseCount(count);
      setCaseCountStatus("ready");
      return count;
    } catch {
      if (lookupId === caseLookupId.current) setCaseCountStatus("failed");
      return null;
    }
  }

  function selectAgent(agentIdValue: string) {
    setAgentId(agentIdValue);
    const agent = agents.find(({ id }) => id === agentIdValue);
    if (agent === undefined) {
      caseLookupId.current += 1;
      setCaseCount(null);
      setCaseCountStatus("idle");
      return;
    }
    void loadCaseCount(agent);
  }

  async function createRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const agent = agents.find(({ id }) => id === agentId);
    if (agent === undefined || objective.trim().length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const availableCases = await loadCaseCount(agent);
      if (availableCases === null || availableCases < 2) return;
      const round: RoundItem = {
        id: crypto.randomUUID(), agentId: agent.id, domainId: agent.domainId,
        objective: objective.trim(), state: "setup", createdAt: new Date().toISOString(),
      };
      const response = await request("/api/v1/rounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: round.id, agentId: round.agentId, domainId: round.domainId, objective: round.objective }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        if (response.status === 422 && typeof body === "object" && body !== null && (body as { code?: unknown }).code === "ROUND_CASES_INSUFFICIENT") {
          setError("cases");
          return;
        }
        throw new Error("ROUND_CREATE_FAILED");
      }
      const created = await response.json() as RoundItem;
      setRounds((previous) => [created, ...previous.filter(({ id }) => id !== created.id)]);
      setActiveRoundId(created.id);
      onRoundSelect?.(created.id);
      setObjective("");
    } catch {
      setError("create");
    } finally {
      setCreating(false);
    }
  }

  async function cancelRound() {
    if (activeRound === undefined) return;
    setCancelling(true);
    setCancelFailed(false);
    try {
      const response = await request(`/api/v1/rounds/${encodeURIComponent(activeRound.id)}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error("ROUND_CANCEL_FAILED");
      // O endpoint só confirma a solicitação; o estado final chega depois pelo stream/checkpoint do worker.
      setCancelRequestedFor(activeRound.id);
    } catch {
      setCancelFailed(true);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="rounds-dashboard">
      <form className="round-create" onSubmit={createRound}>
        <label>{t("roundAgent")}<select value={agentId} onChange={(event) => selectAgent(event.target.value)} required>
          <option value="">{t("selectAgent")}</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.domainId}</option>)}
        </select></label>
        <label>{t("roundObjective")}<input value={objective} onChange={(event) => setObjective(event.target.value)} required maxLength={500} /></label>
        <button type="submit" disabled={creating || agents.length === 0 || !agentId || caseCountStatus !== "ready" || caseCount === null || caseCount < 2 || objective.trim().length === 0}>{creating ? t("creatingRound") : t("createRound")}</button>
        <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}>{t("refreshRounds")}</button>
      </form>
      {error === "load" && <p className="notice error" role="alert">{t("roundLoadFailed")}</p>}
      {error === "create" && <p className="notice error" role="alert">{t("roundCreateFailed")}</p>}
      {error === "cases" && <p className="notice error" role="alert">{t("roundCasesRequired")}</p>}
      {error === "not-found" && <p className="notice error" role="alert">{t("roundNotFound")}</p>}
      {caseCountStatus === "loading" && <p className="notice" role="status">{t("roundCasesLoading")}</p>}
      {caseCountStatus === "failed" && <p className="notice error" role="alert">{t("roundCasesLoadFailed")}</p>}
      {caseCountStatus === "ready" && caseCount !== null && caseCount < 2 && <div className="notice round-readiness" role="status">
        <span>{t("roundCasesRequired")}</span>
        {onPrepareCases && <button className="secondary-button" type="button" onClick={() => onPrepareCases(agentId)}>{t("prepareAgentCases")}</button>}
      </div>}
      {caseCountStatus === "ready" && caseCount !== null && caseCount >= 2 && <p className="field-hint">{t("roundCasesCount").replace("{count}", String(caseCount))}</p>}
      {agents.length === 0 && !loading && <div className="empty-state"><strong>{t("noAgentsForRound")}</strong><span>{t("noAgentsHint")}</span></div>}
      {rounds.length === 0 && !loading && agents.length > 0 && <div className="empty-state"><strong>{t("emptyRounds")}</strong><span>{t("emptyRoundsHint")}</span></div>}
      <ul className="round-list" aria-label={t("roundListLabel")}>
        {rounds.map((round) => (
          <li key={round.id} className={round.id === activeRoundId ? "selected" : ""}>
            <button type="button" onClick={() => { setActiveRoundId(round.id); onRoundSelect?.(round.id); }}>
              <span className="round-id">{round.id}</span><span>{round.objective}</span>
              <span className={`round-state state-${round.state}`}>{t("roundStateLabel")} · {round.state.replaceAll("_", " ")}</span>
            </button>
          </li>
        ))}
      </ul>
      {activeRoundId !== undefined && <div className={`stream-status ${streamState}`} role="status">
        <span aria-hidden="true" />
        {streamState === "connected" ? t("streamConnected") : streamState === "reconnecting" ? t("streamReconnecting") : t("streamConnecting")}
      </div>}
      {latestProgress !== null && latestProgress.roundId === activeRoundId && <p className="notice" role="status">{t("roundProgress").replace("{state}", latestProgress.state.replaceAll("_", " "))}</p>}
      {activeRound !== undefined && !terminalStates.has(activeRound.state) && cancelRequestedFor !== activeRound.id && (
        <button type="button" className="secondary-button danger-button" onClick={() => void cancelRound()} disabled={cancelling}>
          {cancelling ? t("requestingCancellation") : t("cancelRound")}
        </button>
      )}
      {cancelRequestedFor === activeRoundId && <p className="notice" role="status">{t("cancellationRequested")}</p>}
      {cancelFailed && <p className="notice error" role="alert">{t("cancellationFailed")}</p>}
    </div>
  );
}