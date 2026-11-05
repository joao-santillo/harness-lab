from __future__ import annotations

import re
import traceback
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

REDACTED = "[REDACTED]"

_SENSITIVE_KEYS = {
    "authorization",
    "token",
    "accesstoken",
    "refreshtoken",
    "secret",
    "clientsecret",
    "password",
    "apikey",
    "signature",
    "xamzsignature",
}

_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", flags=re.IGNORECASE)


def _is_sensitive_key(key: str) -> bool:
    normalized = "".join(character for character in key if character.isalpha()).lower()
    return normalized in _SENSITIVE_KEYS


def _redact_url(value: str) -> str:
    try:
        split = urlsplit(value)
    except Exception:
        return value

    if split.scheme.lower() not in {"http", "https"} or split.netloc == "":
        return value

    changed = False

    username: str | None = split.username
    host_port = split.netloc
    if "@" in split.netloc:
        username = REDACTED
        host_port = split.netloc.rsplit("@", 1)[1]
        changed = True
    elif username is not None or split.password is not None:
        username = REDACTED
        changed = True

    hostname = split.hostname
    if hostname is None and "@" not in split.netloc:
        return value

    query_pairs = parse_qsl(split.query, keep_blank_values=True)
    redacted_pairs: list[tuple[str, str]] = []
    for key, query_value in query_pairs:
        if _is_sensitive_key(key):
            redacted_pairs.append((key, quote(REDACTED, safe="")))
            changed = True
        else:
            redacted_pairs.append((key, query_value))

    if not changed:
        return value

    userinfo = ""
    if username is not None:
        userinfo = f"{quote(username, safe='')}@"

    if hostname is not None:
        netloc = f"{userinfo}{hostname}"
        if split.port is not None:
            netloc = f"{netloc}:{split.port}"
    else:
        netloc = f"{userinfo}{host_port}"

    query = "&".join(f"{key}={query_value}" for key, query_value in redacted_pairs)
    return urlunsplit((split.scheme, netloc, split.path, query, split.fragment))


def _redact_urls(value: str) -> str:
    return _URL_PATTERN.sub(lambda match: _redact_url(match.group(0)), value)


def create_redactor(secret_values: tuple[str, ...] | list[str] = ()) -> Callable[[Any], Any]:
    expanded: set[str] = set()
    for secret in secret_values:
        if secret == "":
            continue
        encoded = quote(secret, safe="")
        expanded.add(secret)
        expanded.add(encoded)
        expanded.add(encoded.lower())
    known_values = tuple(sorted(expanded, key=len, reverse=True))

    def redact_string(value: str) -> str:
        output = value
        for secret in known_values:
            output = output.replace(secret, REDACTED)
            output = output.replace(secret.upper(), REDACTED)
        redacted = _redact_urls(_redact_url(output))
        redacted = redacted.replace("://[REDACTED]@", "://%5BREDACTED%5D@")
        return redacted

    def redact(value: Any) -> Any:
        seen: dict[int, Any] = {}

        def visit(current: Any) -> Any:
            if isinstance(current, str):
                return redact_string(current)
            if current is None or isinstance(current, (bool, int, float)):
                return current

            current_id = id(current)
            if current_id in seen:
                return seen[current_id]

            if isinstance(current, list):
                output_list: list[Any] = []
                seen[current_id] = output_list
                for item in current:
                    output_list.append(visit(item))
                return output_list

            if isinstance(current, tuple):
                output_tuple = tuple(visit(item) for item in current)
                seen[current_id] = output_tuple
                return output_tuple

            if isinstance(current, BaseException):
                output_error: dict[str, Any] = {
                    "name": current.__class__.__name__,
                    "message": redact_string(str(current)),
                }
                seen[current_id] = output_error
                stack = "".join(traceback.format_exception(type(current), current, current.__traceback__))
                if stack != "":
                    output_error["stack"] = redact_string(stack)
                if current.__cause__ is not None:
                    output_error["cause"] = visit(current.__cause__)
                for key, item in vars(current).items():
                    output_error[key] = REDACTED if _is_sensitive_key(key) else visit(item)
                return output_error

            if isinstance(current, Mapping):
                output_dict: dict[str, Any] = {}
                seen[current_id] = output_dict
                for key, item in current.items():
                    text_key = str(key)
                    output_dict[text_key] = REDACTED if _is_sensitive_key(text_key) else visit(item)
                return output_dict

            return redact_string(str(current))

        return visit(value)

    return redact
