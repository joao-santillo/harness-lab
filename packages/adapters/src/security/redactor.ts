const REDACTED = "[REDACTED]";
const sensitiveKeys = new Set([
  "authorization", "token", "accesstoken", "refreshtoken", "secret", "clientsecret",
  "password", "apikey", "signature", "xamzsignature",
]);

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.replace(/[^a-z]/giu, "").toLowerCase());
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    let changed = false;
    if (url.username !== "" || url.password !== "") {
      url.username = REDACTED;
      url.password = "";
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

function redactUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/giu, (url) => redactUrl(url));
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function createRedactor(secretValues: readonly string[] = []): (value: unknown) => unknown {
  const knownValues = [...new Set(secretValues
    .filter((value) => value.length > 0)
    .flatMap((value) => [value, encodeURIComponent(value), encodeURIComponent(value).toLowerCase()]))]
    .sort((left, right) => right.length - left.length);

  function redactString(value: string): string {
    const withoutSecrets = knownValues.reduce(
      (result, secret) => result.replaceAll(secret, REDACTED).replaceAll(secret.toUpperCase(), REDACTED),
      value,
    );
    return redactUrls(redactUrl(withoutSecrets));
  }

  return (value: unknown): unknown => {
    const seen = new WeakMap<object, unknown>();
    function visit(current: unknown): unknown {
      if (typeof current === "string") return redactString(current);
      if (current === null || typeof current !== "object") return current;
      const existing = seen.get(current);
      if (existing !== undefined) return existing;
      if (Array.isArray(current)) {
        const output: unknown[] = [];
        seen.set(current, output);
        for (const item of current) output.push(visit(item));
        return output;
      }
      if (current instanceof Error) {
        const output: Record<string, unknown> = {
          name: current.name,
          message: redactString(current.message),
        };
        seen.set(current, output);
        if (current.stack !== undefined) output.stack = redactString(current.stack);
        if (current.cause !== undefined) output.cause = visit(current.cause);
        for (const [key, item] of Object.entries(current)) {
          output[key] = isSensitiveKey(key) ? REDACTED : visit(item);
        }
        return output;
      }
      if (!isPlainRecord(current)) return redactString(String(current));
      const output: Record<string, unknown> = {};
      seen.set(current, output);
      for (const [key, item] of Object.entries(current)) {
        output[key] = isSensitiveKey(key) ? REDACTED : visit(item);
      }
      return output;
    }
    return visit(value);
  };
}