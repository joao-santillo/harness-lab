import { useCallback, useEffect, useState } from "react";
import type { MessageKey } from "../../i18n/messages.js";

type ConnectionKind = "langfuse" | "agent-platform";

type ConnectionSummary = {
  readonly id: string;
  readonly kind: ConnectionKind;
  readonly name: string;
  readonly configured: boolean;
};

interface ConnectionsListProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
  refreshKey?: number;
}

type LoadStatus = "loading" | "ready" | "error";

function isConnectionSummary(value: unknown): value is ConnectionSummary {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" &&
    (item.kind === "langfuse" || item.kind === "agent-platform") &&
    typeof item.name === "string" &&
    typeof item.configured === "boolean";
}

export function ConnectionsList({ t, request = fetch, refreshKey = 0 }: ConnectionsListProps) {
  const [items, setItems] = useState<readonly ConnectionSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");

  const loadConnections = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await request("/api/v1/connections");
      if (!response.ok) throw new Error("CONNECTIONS_LOAD_FAILED");
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || !Array.isArray((body as { items?: unknown }).items)) {
        throw new Error("CONNECTIONS_RESPONSE_INVALID");
      }
      const nextItems = (body as { items: unknown[] }).items;
      if (!nextItems.every(isConnectionSummary)) throw new Error("CONNECTIONS_RESPONSE_INVALID");
      setItems(nextItems);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [request]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections, refreshKey]);

  return (
    <section aria-labelledby="saved-connections-title" className="connections-panel">
      <div className="connections-panel-heading">
        <div>
          <p className="setup-card-label">{t("savedConnectionsLabel")}</p>
          <h2 id="saved-connections-title">{t("savedConnectionsTitle")}</h2>
          <p>{t("savedConnectionsDescription")}</p>
        </div>
        <button className="secondary-button" disabled={status === "loading"} onClick={() => { void loadConnections(); }} type="button">
          {t("refreshConnections")}
        </button>
      </div>

      {status === "loading" && <p className="notice" role="status">{t("loadingConnections")}</p>}
      {status === "error" && <p className="notice error" role="alert">{t("connectionsLoadFailed")}</p>}
      {status === "ready" && items.length === 0 && (
        <div className="empty-state">
          <strong>{t("emptyConnections")}</strong>
          <span>{t("emptyConnectionsHint")}</span>
        </div>
      )}
      {status === "ready" && items.length > 0 && (
        <ul aria-label={t("savedConnectionsTitle")} className="connection-list">
          {items.map((item) => (
            <li className="connection-card" key={item.id}>
              <div className="connection-card-heading">
                <strong>{item.name}</strong>
                <span className={`connection-kind ${item.kind}`}>
                  {item.kind === "langfuse" ? t("langfuse") : t("agentPlatform")}
                </span>
              </div>
              <span className="connection-status">
                {item.configured ? t("connectionConfigured") : t("connectionNotConfigured")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
