import { useEffect, useState } from "react";
import type { MessageKey } from "../../i18n/messages.js";

interface ResultItem {
  readonly roundId: string;
  readonly decision: string;
  readonly sampleSize: number;
  readonly confidence: number;
  readonly rationale: string;
  readonly limitations: readonly string[];
}
interface RoundSummary {
  readonly id: string;
  readonly state: string;
}
interface ResultRow {
  readonly roundId: string;
  readonly state: string;
  readonly result: ResultItem | null;
  readonly status: "ready" | "not-ready" | "failed";
}
interface ResultsDashboardProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
  selectedRoundId?: string;
  onResultSelect?(roundId: string): void;
}

const terminalStates = new Set(["recommended", "rejected", "inconclusive", "pending_validation", "validation_insufficient", "stopped_by_limit", "cancelled", "integration_failed"]);
const decisionMessage: Readonly<Record<string, MessageKey>> = {
  recommended: "decisionRecommended", rejected: "decisionRejected", inconclusive: "decisionInconclusive",
  pending_validation: "decisionPending", validation_insufficient: "decisionInsufficient",
  stopped_by_limit: "decisionLimit", cancelled: "decisionCancelled", integration_failed: "decisionFailed",
};

export function ResultsDashboard({ t, request = fetch, selectedRoundId, onResultSelect }: ResultsDashboardProps) {
  const [rows, setRows] = useState<readonly ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  async function loadResults() {
    setLoading(true);
    setFailed(false);
    try {
      if (selectedRoundId !== undefined) {
        const roundResponse = await request(`/api/v1/rounds/${encodeURIComponent(selectedRoundId)}`);
        if (!roundResponse.ok) {
          setRows([{ roundId: selectedRoundId, state: "unknown", result: null, status: "failed" }]);
          return;
        }
        const round = await roundResponse.json() as RoundSummary;
        if (!terminalStates.has(round.state)) {
          setRows([{ roundId: round.id, state: round.state, result: null, status: "not-ready" }]);
          return;
        }
        try {
          const resultResponse = await request(`/api/v1/rounds/${encodeURIComponent(round.id)}/results`);
          setRows([resultResponse.ok
            ? { roundId: round.id, state: round.state, result: await resultResponse.json() as ResultItem, status: "ready" }
            : { roundId: round.id, state: round.state, result: null, status: resultResponse.status === 409 ? "not-ready" : "failed" }]);
        } catch {
          setRows([{ roundId: round.id, state: round.state, result: null, status: "failed" }]);
        }
        return;
      }
      const response = await request("/api/v1/rounds");
      if (!response.ok) throw new Error("ROUND_LIST_FAILED");
      const body = await response.json() as { items: RoundSummary[] };
      const terminal = body.items.filter(({ state }) => terminalStates.has(state));
      const settled = await Promise.all(terminal.map(async ({ id, state }) => {
        try {
          const response = await request(`/api/v1/rounds/${encodeURIComponent(id)}/results`);
          if (response.ok) return { roundId: id, state, result: await response.json() as ResultItem, status: "ready" as const };
          return { roundId: id, state, result: null, status: response.status === 409 ? "not-ready" as const : "failed" as const };
        } catch {
          return { roundId: id, state, result: null, status: "failed" as const };
        }
      }));
      setRows(settled);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadResults(); }, [request, selectedRoundId]);

  const visibleRows = selectedRoundId === undefined ? rows : rows.filter(({ roundId }) => roundId === selectedRoundId);

  return (
    <div className="results-dashboard">
      <button type="button" className="secondary-button" onClick={() => void loadResults()} disabled={loading}>{t("refreshResults")}</button>
      {failed && <p className="notice error" role="alert">{t("resultsLoadFailed")}</p>}
      {loading && <p role="status">{t("loadingResults")}</p>}
      {!loading && !failed && visibleRows.length === 0 && <div className="empty-state"><strong>{t("emptyResults")}</strong><span>{t("emptyResultsHint")}</span></div>}
      <ul className="result-list">
        {visibleRows.map((row) => (
          <li key={row.roundId} className="result-card">
            <div className="result-card-heading">
              {onResultSelect
                ? <button className="result-route-link round-id" type="button" onClick={() => onResultSelect(row.roundId)}>{row.roundId}</button>
                : <span className="round-id">{row.roundId}</span>}
              <strong>{row.result ? t(decisionMessage[row.result.decision] ?? "decisionFailed") : row.state.replaceAll("_", " ")}</strong>
            </div>
            {row.result ? <>
              <p>{row.result.rationale}</p>
              <dl><div><dt>{t("resultSamples")}</dt><dd>{row.result.sampleSize}</dd></div><div><dt>{t("resultConfidence")}</dt><dd>{Math.round(row.result.confidence * 100)}%</dd></div></dl>
              {row.result.limitations.length > 0 && <p className="result-limitations">{t("resultLimitations")}: {row.result.limitations.join(" · ")}</p>}
            </> : <p className={row.status === "failed" ? "notice error" : "notice"} role={row.status === "failed" ? "alert" : "status"}>
              {t(row.status === "not-ready" ? "resultNotReady" : "resultUnavailable")}
            </p>}
          </li>
        ))}
      </ul>
    </div>
  );
}