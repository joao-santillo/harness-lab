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
interface ResultsDashboardProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
}

const terminalStates = new Set(["recommended", "rejected", "inconclusive", "pending_validation", "validation_insufficient", "stopped_by_limit", "cancelled", "integration_failed"]);
const decisionMessage: Readonly<Record<string, MessageKey>> = {
  recommended: "decisionRecommended", rejected: "decisionRejected", inconclusive: "decisionInconclusive",
  pending_validation: "decisionPending", validation_insufficient: "decisionInsufficient",
  stopped_by_limit: "decisionLimit", cancelled: "decisionCancelled", integration_failed: "decisionFailed",
};

export function ResultsDashboard({ t, request = fetch }: ResultsDashboardProps) {
  const [results, setResults] = useState<readonly ResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  async function loadResults() {
    setLoading(true);
    setFailed(false);
    try {
      const response = await request("/api/v1/rounds");
      if (!response.ok) throw new Error("ROUND_LIST_FAILED");
      const body = await response.json() as { items: Array<{ id: string; state: string }> };
      const terminal = body.items.filter(({ state }) => terminalStates.has(state));
      const settled = await Promise.all(terminal.map(async ({ id }) => {
        const result = await request(`/api/v1/rounds/${encodeURIComponent(id)}/results`);
        return result.ok ? await result.json() as ResultItem : null;
      }));
      setResults(settled.filter((item): item is ResultItem => item !== null));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadResults(); }, [request]);

  return (
    <div className="results-dashboard">
      <button type="button" className="secondary-button" onClick={() => void loadResults()} disabled={loading}>{t("refreshResults")}</button>
      {failed && <p className="notice error" role="alert">{t("resultsLoadFailed")}</p>}
      {loading && <p role="status">{t("loadingResults")}</p>}
      {!loading && !failed && results.length === 0 && <div className="empty-state"><strong>{t("emptyResults")}</strong><span>{t("emptyResultsHint")}</span></div>}
      <ul className="result-list">
        {results.map((result) => (
          <li key={result.roundId} className="result-card">
            <div className="result-card-heading"><span className="round-id">{result.roundId}</span><strong>{t(decisionMessage[result.decision] ?? "decisionFailed")}</strong></div>
            <p>{result.rationale}</p>
            <dl><div><dt>{t("resultSamples")}</dt><dd>{result.sampleSize}</dd></div><div><dt>{t("resultConfidence")}</dt><dd>{Math.round(result.confidence * 100)}%</dd></div></dl>
            {result.limitations.length > 0 && <p className="result-limitations">{t("resultLimitations")}: {result.limitations.join(" · ")}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}