import { useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ConnectionsDashboard } from "./features/connections/connections-dashboard.js";
import { AgentCaseForm } from "./features/cases/agent-case-form.js";
import { RoundsDashboard } from "./features/rounds/rounds-dashboard.js";
import { ResultsDashboard } from "./features/rounds/results-dashboard.js";
import type { EventSourceFactory } from "./features/rounds/use-round-events.js";
import { messages, type Locale, type MessageKey } from "./i18n/messages.js";
import "./styles.css";

interface AppProps {
  activeRoundId?: string;
  eventSourceFactory?: EventSourceFactory;
  request?: typeof fetch;
}

const browserEventSourceFactory: EventSourceFactory = (url) => new EventSource(url);

export function App({ activeRoundId, eventSourceFactory = browserEventSourceFactory, request = fetch }: AppProps) {
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const [connectionsRefreshKey, setConnectionsRefreshKey] = useState(0);
  const t = (key: MessageKey) => messages[locale][key];

  return (
    <BrowserRouter>
      <AppShell
        {...(activeRoundId === undefined ? {} : { activeRoundId })}
        connectionsRefreshKey={connectionsRefreshKey}
        eventSourceFactory={eventSourceFactory}
        onConnectionSaved={() => setConnectionsRefreshKey((current) => current + 1)}
        request={request}
        setLocale={setLocale}
        t={t}
        locale={locale}
      />
    </BrowserRouter>
  );
}

interface AppShellProps {
  activeRoundId?: string;
  connectionsRefreshKey: number;
  eventSourceFactory: EventSourceFactory;
  locale: Locale;
  onConnectionSaved(): void;
  request: typeof fetch;
  setLocale: (locale: Locale) => void;
  t(key: MessageKey): string;
}

const resourceLinks = [
  { path: "/agents", key: "agents" },
  { path: "/connections", key: "connections" },
  { path: "/rounds", key: "rounds" },
  { path: "/results", key: "results" },
] as const satisfies readonly { path: string; key: MessageKey }[];

function AppShell({ activeRoundId, connectionsRefreshKey, eventSourceFactory, locale, onConnectionSaved, request, setLocale, t }: AppShellProps) {
  const navigate = useNavigate();

  function agentCasesPath(agentId: string, step: 1 | 2 | 3): string {
    if (step === 1) return "/agents";
    const root = `/agents/${encodeURIComponent(agentId)}/cases`;
    return step === 2 ? `${root}/import` : root;
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

      <nav aria-label={t("navLabel")} className="sidebar">
        <div className="resource-nav">
          {resourceLinks.map(({ path, key }) => (
            <NavLink className={({ isActive }) => isActive ? "active" : ""} key={path} to={path}>
              {t(key)}
            </NavLink>
          ))}
        </div>
      </nav>

      <main id="content">
        <Routes>
          <Route path="/" element={<Navigate replace to="/agents" />} />
          <Route path="/agents" element={<AgentCaseForm
            connectionsRefreshKey={connectionsRefreshKey}
            onAgentSelected={(agentId, step) => navigate(agentCasesPath(agentId, step))}
            onStepChange={(agentId, step) => navigate(agentCasesPath(agentId, step))}
            request={request}
            t={t}
          />} />
          <Route path="/agents/:agentId/cases" element={<AgentCaseRoute
            connectionsRefreshKey={connectionsRefreshKey}
            onStepChange={(agentId, step) => navigate(agentCasesPath(agentId, step))}
            request={request}
            t={t}
          />} />
          <Route path="/agents/:agentId/cases/import" element={<AgentCaseRoute
            connectionsRefreshKey={connectionsRefreshKey}
            onStepChange={(agentId, step) => navigate(agentCasesPath(agentId, step))}
            request={request}
            t={t}
          />} />
          <Route path="/connections" element={<ConnectionsDashboard
            onSaved={onConnectionSaved}
            refreshKey={connectionsRefreshKey}
            request={request}
            t={t}
          />} />
          <Route path="/rounds" element={<RoundsRoute
            eventSourceFactory={eventSourceFactory}
            request={request}
            t={t}
            {...(activeRoundId === undefined ? {} : { fallbackRoundId: activeRoundId })}
          />} />
          <Route path="/rounds/:roundId" element={<RoundsRoute
            eventSourceFactory={eventSourceFactory}
            request={request}
            t={t}
            {...(activeRoundId === undefined ? {} : { fallbackRoundId: activeRoundId })}
          />} />
          <Route path="/results" element={<ResultsRoute request={request} t={t} />} />
          <Route path="/results/:roundId" element={<ResultsRoute request={request} t={t} />} />
          <Route path="*" element={<Navigate replace to="/agents" />} />
        </Routes>
      </main>
    </div>
  );
}

interface RouteComponentProps {
  request: typeof fetch;
  t(key: MessageKey): string;
}

function AgentCaseRoute({ connectionsRefreshKey, onStepChange, request, t }: RouteComponentProps & {
  connectionsRefreshKey: number;
  onStepChange(agentId: string, step: 1 | 2 | 3): void;
}) {
  const { agentId } = useParams();
  const location = useLocation();
  const initialStep: 2 | 3 = location.pathname.endsWith("/import") ? 2 : 3;
  if (agentId === undefined) return <Navigate replace to="/agents" />;
  return <>
    <nav aria-label={t("breadcrumbLabel")} className="breadcrumbs">
      <NavLink to="/agents">{t("agents")}</NavLink>
      <span>{agentId}</span>
      <span>{t(initialStep === 2 ? "importCases" : "casesBrowserTitle")}</span>
    </nav>
    <AgentCaseForm
      connectionsRefreshKey={connectionsRefreshKey}
      initialAgentId={agentId}
      initialStep={initialStep}
      onStepChange={onStepChange}
      request={request}
      t={t}
    />
  </>;
}

function RoundsRoute({ eventSourceFactory, fallbackRoundId, request, t }: RouteComponentProps & {
  eventSourceFactory: EventSourceFactory;
  fallbackRoundId?: string;
}) {
  const { roundId } = useParams();
  const navigate = useNavigate();
  const initialActiveRoundId = roundId ?? fallbackRoundId;
  return (
    <section aria-labelledby="rounds-title">
      <div className="section-heading">
        <h1 id="rounds-title">{t("roundsTitle")}</h1>
        <p>{t("roundsDescription")}</p>
      </div>
      <RoundsDashboard
        eventSourceFactory={eventSourceFactory}
        {...(initialActiveRoundId === undefined ? {} : { initialActiveRoundId })}
        onPrepareCases={(agentId) => navigate(`/agents/${encodeURIComponent(agentId)}/cases/import`)}
        onRoundSelect={(id) => navigate(`/rounds/${encodeURIComponent(id)}`)}
        request={request}
        t={t}
      />
    </section>
  );
}

function ResultsRoute({ request, t }: RouteComponentProps) {
  const { roundId } = useParams();
  const navigate = useNavigate();
  return (
    <section aria-labelledby="results-title">
      <div className="section-heading">
        <h1 id="results-title">{t("resultsTitle")}</h1>
        <p>{t("resultsDescription")}</p>
      </div>
      <ResultsDashboard
        onResultSelect={(id) => navigate(`/results/${encodeURIComponent(id)}`)}
        request={request}
        {...(roundId === undefined ? {} : { selectedRoundId: roundId })}
        t={t}
      />
    </section>
  );
}