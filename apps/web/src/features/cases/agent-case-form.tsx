import { useState, type FormEvent } from "react";
import type { MessageKey } from "../../i18n/messages.js";

interface AgentCaseFormProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
}

interface CaseImportInput {
  readonly id: string;
  readonly sessionId: string;
  readonly similarityGroup: string;
  readonly content: string;
  readonly syntheticLabel?: "SYNTHETIC";
}

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

export function AgentCaseForm({ t, request = fetch }: AgentCaseFormProps) {
  const [agentReady, setAgentReady] = useState(false);
  const [scope, setScope] = useState<{ agentId: string; domainId: string } | null>(null);
  const [agentStatus, setAgentStatus] = useState<"idle" | "saving" | "created" | "conflict" | "failed">("idle");
  const [caseStatus, setCaseStatus] = useState<"idle" | "importing" | "invalid" | "imported" | "conflict" | "failed">("idle");
  const [caseFormat, setCaseFormat] = useState<"json" | "csv">("json");
  const [caseSource, setCaseSource] = useState<"manual" | "json" | "historical" | "synthetic">("json");

  function invalidateAgentScope() {
    setAgentReady(false);
    setScope(null);
    setAgentStatus("idle");
    setCaseStatus("idle");
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
      } else if (response.status === 409) {
        setScope({ agentId: id, domainId });
        setAgentReady(true);
        setAgentStatus("conflict");
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
      } else if (response.status === 409) {
        setCaseStatus("conflict");
      } else {
        setCaseStatus("failed");
      }
    } catch {
      setCaseStatus("failed");
    }
  }

  return (
    <section className="case-setup" aria-labelledby="case-setup-title">
      <div className="section-heading">
        <p className="eyebrow">{t("caseSetupEyebrow")}</p>
        <h2 id="case-setup-title">{t("caseSetupTitle")}</h2>
        <p>{t("caseSetupDescription")}</p>
      </div>
      <div className="case-setup-grid">
        <form className="setup-card" onSubmit={createAgent}>
          <span className="setup-card-label">{t("agentStepLabel")}</span>
          <h3>{t("createAgentTitle")}</h3>
          <label>{t("agentId")}<input name="agentId" required autoComplete="off" onChange={invalidateAgentScope} /></label>
          <label>{t("domainId")}<input name="domainId" required autoComplete="off" onChange={invalidateAgentScope} /></label>
          <label>{t("agentName")}<input name="agentName" required onChange={invalidateAgentScope} /></label>
          {agentStatus === "created" && <p className="notice success" role="status">{t("agentCreated")}</p>}
          {agentStatus === "conflict" && <p className="notice" role="status">{t("agentExists")}</p>}
          {agentStatus === "failed" && <p className="notice error" role="alert">{t("agentSaveFailed")}</p>}
          <button type="submit" disabled={agentStatus === "saving"}>{agentStatus === "saving" ? t("savingAgent") : t("createAgent")}</button>
        </form>

        <form className="setup-card" onSubmit={importCases}>
          <span className="setup-card-label">{t("casesStepLabel")}</span>
          <h3>{t(caseFormat === "csv" ? "importCasesCsvTitle" : "importCasesTitle")}</h3>
          <label>{t("caseFormat")}<select value={caseFormat} onChange={(event) => { setCaseFormat(event.target.value as typeof caseFormat); setCaseStatus("idle"); }}>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select></label>
          {caseFormat === "json" && <label>{t("caseSource")}<select value={caseSource} onChange={(event) => { setCaseSource(event.target.value as typeof caseSource); setCaseStatus("idle"); }}>
            <option value="json">{t("sourceJson")}</option>
            <option value="manual">{t("sourceManual")}</option>
            <option value="historical">{t("sourceHistorical")}</option>
            <option value="synthetic">{t("sourceSynthetic")}</option>
          </select></label>}
          {caseFormat === "json" && caseSource === "historical" && <label>{t("sourceReference")}<input name="sourceReference" required /></label>}
          {caseFormat === "json" && caseSource === "synthetic" && <label>{t("syntheticLabel")}<input name="syntheticLabel" required placeholder="SYNTHETIC" /></label>}
          {caseFormat === "json"
            ? <label>{t("casesJson")}<textarea name="casesJson" rows={8} required placeholder={t("casesJsonPlaceholder")} /></label>
            : <label>{t("casesCsv")}<textarea name="casesCsv" rows={8} required placeholder={t("casesCsvPlaceholder")} /></label>}
          {caseStatus === "invalid" && <p className="notice error" role="alert">{t("caseImportInvalid")}</p>}
          {caseStatus === "imported" && <p className="notice success" role="status">{t("casesImported")}</p>}
          {caseStatus === "conflict" && <p className="notice error" role="alert">{t("caseConflict")}</p>}
          {caseStatus === "failed" && <p className="notice error" role="alert">{t("caseImportFailed")}</p>}
          {caseStatus === "importing" && <p className="notice" role="status">{t("importingCases")}</p>}
          <button type="submit" disabled={!agentReady || caseStatus === "importing"}>{t("importCases")}</button>
        </form>
      </div>
    </section>
  );
}