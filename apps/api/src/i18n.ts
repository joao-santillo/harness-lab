export type Locale = "pt-BR" | "en" | "es";

const messages = {
  "pt-BR": {
    CONNECTION_INVALID: "Dados da conexão inválidos.",
    CONNECTION_NOT_FOUND: "Conexão não encontrada.",
    CONNECTION_AUTH_FAILED: "As credenciais da conexão foram rejeitadas.",
    CONNECTION_UNAVAILABLE: "O serviço da conexão está indisponível.",
    IDEMPOTENCY_CONFLICT: "A chave de idempotência pertence a outra solicitação.",
    REQUEST_FAILED: "Não foi possível processar a solicitação.",
    ROUTE_NOT_FOUND: "Recurso não encontrado.",
  },
  en: {
    CONNECTION_INVALID: "Invalid connection data.",
    CONNECTION_NOT_FOUND: "Connection not found.",
    CONNECTION_AUTH_FAILED: "The connection credentials were rejected.",
    CONNECTION_UNAVAILABLE: "The connection service is unavailable.",
    IDEMPOTENCY_CONFLICT: "The idempotency key belongs to another request.",
    REQUEST_FAILED: "The request could not be processed.",
    ROUTE_NOT_FOUND: "Resource not found.",
  },
  es: {
    CONNECTION_INVALID: "Datos de conexión no válidos.",
    CONNECTION_NOT_FOUND: "Conexión no encontrada.",
    CONNECTION_AUTH_FAILED: "Las credenciales de conexión fueron rechazadas.",
    CONNECTION_UNAVAILABLE: "El servicio de conexión no está disponible.",
    IDEMPOTENCY_CONFLICT: "La clave de idempotencia pertenece a otra solicitud.",
    REQUEST_FAILED: "No se pudo procesar la solicitud.",
    ROUTE_NOT_FOUND: "Recurso no encontrado.",
  },
} as const;

export type MessageCode = keyof typeof messages.en;

export function resolveLocale(acceptLanguage: string | undefined): Locale {
  const requested = (acceptLanguage ?? "").split(",")
    .map((part, index) => {
      const [tag = "", ...parameters] = part.trim().toLowerCase().split(";");
      const quality = Number(parameters.find((parameter) => parameter.trim().startsWith("q="))?.split("=")[1] ?? "1");
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(({ quality }) => quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);
  for (const { tag } of requested) {
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return "pt-BR";
}

export function localize(code: MessageCode, acceptLanguage?: string): string {
  return messages[resolveLocale(acceptLanguage)][code];
}