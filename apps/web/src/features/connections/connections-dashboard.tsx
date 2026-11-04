import type { MessageKey } from "../../i18n/messages.js";
import { ConnectionForm } from "./connection-form.js";
import { ConnectionsList } from "./connections-list.js";

interface ConnectionsDashboardProps {
  onSaved(): void;
  refreshKey: number;
  request?: typeof fetch;
  t(key: MessageKey): string;
}

export function ConnectionsDashboard({ onSaved, refreshKey, request = fetch, t }: ConnectionsDashboardProps) {
  return (
    <section aria-labelledby="connections-title">
      <div className="section-heading">
        <h1 id="connections-title">{t("connectionsTitle")}</h1>
        <p>{t("connectionsDescription")}</p>
      </div>
      <div className="connections-dashboard">
        <ConnectionForm onSaved={onSaved} request={request} t={t} />
        <ConnectionsList refreshKey={refreshKey} request={request} t={t} />
      </div>
    </section>
  );
}