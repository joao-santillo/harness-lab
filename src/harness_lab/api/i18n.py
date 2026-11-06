from __future__ import annotations

MESSAGES: dict[str, dict[str, str]] = {
    "en": {"ROUTE_NOT_FOUND": "Route not found", "REQUEST_FAILED": "Request failed"},
    "es": {"ROUTE_NOT_FOUND": "Ruta no encontrada", "REQUEST_FAILED": "La solicitud fallo"},
    "pt-BR": {"ROUTE_NOT_FOUND": "Rota nao encontrada", "REQUEST_FAILED": "Falha na solicitacao"},
}


def locale_for(header: str | None) -> str:
    if header:
        for candidate in header.split(","):
            normalized = candidate.split(";", 1)[0].strip()
            if normalized in MESSAGES:
                return normalized
            if normalized.lower().startswith("pt"):
                return "pt-BR"
            if normalized.lower().startswith("es"):
                return "es"
            if normalized.lower().startswith("en"):
                return "en"
    return "pt-BR"


def localize(code: str, header: str | None) -> str:
    return MESSAGES[locale_for(header)].get(code, code)