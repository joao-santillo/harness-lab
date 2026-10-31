import { useState, type FormEvent } from "react";
import type { MessageKey } from "../../i18n/messages.js";

interface ConnectionFormProps {
  t(key: MessageKey): string;
}

export function ConnectionForm({ t }: ConnectionFormProps) {
  const [status, setStatus] = useState<"idle" | "invalid" | "valid">("idle");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const complete = ["name", "publicKey", "secretKey"].every((key) => String(form.get(key) ?? "").trim().length > 0);
    setStatus(complete ? "valid" : "invalid");
  }

  return (
    <form className="connection-form" noValidate onSubmit={submit}>
      <label>
        {t("connectionName")}
        <input name="name" required />
      </label>
      <label>
        {t("connectionKind")}
        <select name="kind" defaultValue="langfuse">
          <option value="langfuse">Langfuse</option>
          <option value="lynn">LYNN</option>
        </select>
      </label>
      <label>
        {t("publicKey")}
        <input name="publicKey" required autoComplete="off" />
      </label>
      <label>
        {t("secretKey")}
        <input name="secretKey" required type="password" autoComplete="new-password" />
      </label>
      {status === "invalid" && <p className="notice error" role="alert">{t("requiredFields")}</p>}
      {status === "valid" && <p className="notice success" role="status">{t("connectionValid")}</p>}
      <button type="submit">{t("validateConnection")}</button>
    </form>
  );
}