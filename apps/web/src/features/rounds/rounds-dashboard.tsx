import { useEffect, useState, type FormEvent } from "react";
import type { MessageKey } from "../../i18n/messages.js";
import { useRoundEvents, type EventSourceFactory } from "./use-round-events.js";

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
}

const eventSourceFactory: EventSourceFactory = (url) => new EventSource(url);
const terminalStates = new Set(["recommended", "rejected", "inconclusive", "pending_validation", "validation_insufficient", "stopped_by_limit", "cancelled", "integration_failed"]);

export function RoundsDashboard({ t, request = fetch, eventSourceFactory: makeEventSource = eventSourceFactory, initialActiveRoundId }: RoundsDashboardProps) {
  const [agents, setAgents] = useState<readonly AgentItem[]>([]);
  const [rounds, setRounds] = useState<readonly RoundItem[]>([]);
  const [agentId, setAgentId] = useState("");
  const [objective, setObjective] = useState("");
  const [activeRoundId, setActiveRoundId] = useState<string | undefined>(initialActiveRoundId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"load" | "create" | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRequestedFor, setCancelRequestedFor] = useState<string | null>(null);
  const [cancelFailed, setCancelFailed] = useState(false);
  const streamState = useRoundEvents(activeRoundId, makeEventSource);
  const activeRound = rounds.find(({ id }) => id === activeRoundId);

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
      setAgents(agentBody.items);
      setRounds(roundBody.items);
    } catch {
      setError("load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [request]);

  async function createRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const agent = agents.find(({ id }) => id === agentId);
    if (agent === undefined || objective.trim().length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const round: RoundItem = {
        id: crypto.randomUUID(), agentId: agent.id, domainId: agent.domainId,
        objective: objective.trim(), state: "setup", createdAt: new Date().toISOString(),
      };
      const response = await request("/api/v1/rounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(round),
      });
      if (!response.ok) throw new Error("ROUND_CREATE_FAILED");
      const created = await response.json() as RoundItem;
      setRounds((previous) => [created, ...previous.filter(({ id }) => id !== created.id)]);
      setActiveRoundId(created.id);
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
        <label>{t("roundAgent")}<select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
          <option value="">{t("selectAgent")}</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.domainId}</option>)}
        </select></label>
        <label>{t("roundObjective")}<input value={objective} onChange={(event) => setObjective(event.target.value)} required maxLength={500} /></label>
        <button type="submit" disabled={creating || agents.length === 0}>{creating ? t("creatingRound") : t("createRound")}</button>
        <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}>{t("refreshRounds")}</button>
      </form>
      {error === "load" && <p className="notice error" role="alert">{t("roundLoadFailed")}</p>}
      {error === "create" && <p className="notice error" role="alert">{t("roundCreateFailed")}</p>}
      {agents.length === 0 && !loading && <div className="empty-state"><strong>{t("noAgentsForRound")}</strong><span>{t("noAgentsHint")}</span></div>}
      {rounds.length === 0 && !loading && agents.length > 0 && <div className="empty-state"><strong>{t("emptyRounds")}</strong><span>{t("emptyRoundsHint")}</span></div>}
      <ul className="round-list" aria-label={t("roundListLabel")}>
        {rounds.map((round) => (
          <li key={round.id} className={round.id === activeRoundId ? "selected" : ""}>
            <button type="button" onClick={() => setActiveRoundId(round.id)}>
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