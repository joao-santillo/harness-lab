import { useRef, useState, type FormEvent } from "react";
import type { MessageKey } from "../../i18n/messages.js";

interface ConnectionFormProps {
  t(key: MessageKey): string;
  request?: typeof fetch;
  onSaved?: () => void;
}

type ConnectionStatus = "idle" | "invalid" | "submitting" | "saved" | "auth-failed" | "unavailable" | "conflict" | "failed";

export function ConnectionForm({ onSaved, t, request = fetch }: ConnectionFormProps) {
  const [kind, setKind] = useState<"langfuse" | "agent-platform">("langfuse");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const registrationIdentity = useRef<{ signature: string; id: string; idempotencyKey: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const credentials = kind === "langfuse"
      ? { baseUrl: String(form.get("baseUrl") ?? "").trim(), publicKey: String(form.get("publicKey") ?? "").trim(), secretKey: String(form.get("secretKey") ?? "") }
      : { baseUrl: String(form.get("baseUrl") ?? "").trim(), token: String(form.get("token") ?? "") };
    const complete = String(form.get("name") ?? "").trim().length > 0 && credentials.baseUrl.length > 0 &&
      (kind === "langfuse"
        ? "publicKey" in credentials && "secretKey" in credentials && credentials.publicKey.length > 0 && credentials.secretKey.length > 0
        : "token" in credentials && credentials.token.length > 0);
    if (!complete) {
      setStatus("invalid");
      return;
    }

    setStatus("submitting");
    const connectionName = String(form.get("name")).trim();
    const slug = connectionName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 60) || "connection";
    const signature = `${kind}:${connectionName}:${credentials.baseUrl}`;
    // Se a resposta se perder depois do commit no servidor, o retry usa a mesma chave e não duplica o registro.
    if (registrationIdentity.current?.signature !== signature) {
      registrationIdentity.current = {
        signature,
        id: `${kind}-${slug}-${crypto.randomUUID().slice(0, 8)}`,
        idempotencyKey: crypto.randomUUID(),
      };
    }
    const identity = registrationIdentity.current;
    try {
      const response = await request("/api/v1/connections", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": identity.idempotencyKey },
        body: JSON.stringify({
          id: identity.id,
          kind,
          name: connectionName,
          credentials,
        }),
      });
      if (response.ok) {
        setStatus("saved");
        onSaved?.();
      } else if (response.status === 409) {
        setStatus("conflict");
      } else if (response.status === 422) {
        setStatus("auth-failed");
      } else if (response.status >= 500) {
        setStatus("unavailable");
      } else {
        setStatus("failed");
      }
    } catch {
      setStatus("unavailable");
    } finally {
      formElement.querySelectorAll<HTMLInputElement>("[data-sensitive]").forEach((input) => { input.value = ""; });
    }
  }

  return (
    <form className="connection-form" noValidate onSubmit={submit}>
      <label>
        {t("connectionName")}
        <input name="name" required />
      </label>
      <label>
        {t("connectionKind")}
        <select name="kind" value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setStatus("idle"); }}>
          <option value="langfuse">Langfuse</option>
          <option value="agent-platform">Agent Platform</option>
        </select>
      </label>
      <label>
        {t("baseUrl")}
        <input name="baseUrl" type="url" required placeholder="https://" />
      </label>
      {kind === "langfuse" ? <>
        <label>
          {t("publicKey")}
          <input name="publicKey" required autoComplete="off" data-sensitive />
        </label>
        <label>
          {t("secretKey")}
          <input name="secretKey" required type="password" autoComplete="new-password" data-sensitive />
        </label>
      </> : (
        <label>
          {t("agentPlatformToken")}
          <input name="token" required type="password" autoComplete="new-password" data-sensitive />
        </label>
      )}
      {status === "invalid" && <p className="notice error" role="alert">{t("requiredFields")}</p>}
      {status === "submitting" && <p className="notice" role="status">{t("savingConnection")}</p>}
      {status === "saved" && <p className="notice success" role="status">{t("connectionSaved")}</p>}
      {status === "auth-failed" && <p className="notice error" role="alert">{t("connectionAuthFailed")}</p>}
      {status === "unavailable" && <p className="notice error" role="alert">{t("connectionUnavailable")}</p>}
      {status === "conflict" && <p className="notice error" role="alert">{t("connectionConflict")}</p>}
      {status === "failed" && <p className="notice error" role="alert">{t("connectionFailed")}</p>}
      <button type="submit" disabled={status === "submitting"}>{t("saveConnection")}</button>
    </form>
  );
}