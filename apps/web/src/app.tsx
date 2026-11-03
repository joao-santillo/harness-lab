import { useRef, useState, type KeyboardEvent } from "react";
import { ConnectionForm } from "./features/connections/connection-form.js";
import { AgentCaseForm } from "./features/cases/agent-case-form.js";
import { RoundsDashboard } from "./features/rounds/rounds-dashboard.js";
import { ResultsDashboard } from "./features/rounds/results-dashboard.js";
import type { EventSourceFactory } from "./features/rounds/use-round-events.js";
import { messages, type Locale, type MessageKey } from "./i18n/messages.js";
import "./styles.css";

type View = "agents" | "rounds" | "results";

interface AppProps {
  activeRoundId?: string;
  eventSourceFactory?: EventSourceFactory;
  request?: typeof fetch;
}

const browserEventSourceFactory: EventSourceFactory = (url) => new EventSource(url);
const views = ["agents", "rounds", "results"] as const;

export function App({ activeRoundId, eventSourceFactory = browserEventSourceFactory, request = fetch }: AppProps) {
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const [view, setView] = useState<View>("agents");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = (key: MessageKey) => messages[locale][key];

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + offset + views.length) % views.length;
    const nextView = views[nextIndex]!;
    setView(nextView);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>Harness²</strong>
          <span>{t("operations")}</span>
        </div>
        <label className="locale-picker">
          {t("locale")}
          <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="pt-BR">Português</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </header>

      <nav aria-label={t("navLabel")} className="sidebar" role="navigation">
        <div role="tablist" aria-label={t("navLabel")}>
        {views.map((item, index) => (
          <button
            aria-controls={`${item}-panel`}
            aria-selected={view === item}
            className={view === item ? "active" : ""}
            id={`${item}-tab`}
            key={item}
            onClick={() => setView(item)}
            onKeyDown={(event) => moveTab(event, index)}
            ref={(element) => { tabRefs.current[index] = element; }}
            role="tab"
            tabIndex={view === item ? 0 : -1}
            type="button"
          >
            {t(item)}
          </button>
        ))}
        </div>
      </nav>

      <main id="content">
        {view === "agents" && (
          <section aria-labelledby="agents-tab" id="agents-panel" role="tabpanel">
            <div className="section-heading">
              <p className="eyebrow">Agent Platform + Langfuse</p>
              <h1 id="agents-title">{t("agentsTitle")}</h1>
              <p>{t("agentsDescription")}</p>
            </div>
            <ConnectionForm t={t} request={request} />
            <AgentCaseForm t={t} request={request} />
          </section>
        )}
        {view === "rounds" && (
          <section aria-labelledby="rounds-tab" id="rounds-panel" role="tabpanel">
            <div className="section-heading">
              <h1 id="rounds-title">{t("roundsTitle")}</h1>
              <p>{t("roundsDescription")}</p>
            </div>
            <RoundsDashboard t={t} request={request} eventSourceFactory={eventSourceFactory} {...(activeRoundId === undefined ? {} : { initialActiveRoundId: activeRoundId })} />
          </section>
        )}
        {view === "results" && (
          <section aria-labelledby="results-tab" id="results-panel" role="tabpanel">
            <div className="section-heading">
              <h1 id="results-title">{t("resultsTitle")}</h1>
              <p>{t("resultsDescription")}</p>
            </div>
            <ResultsDashboard t={t} request={request} />
          </section>
        )}
      </main>
    </div>
  );
}