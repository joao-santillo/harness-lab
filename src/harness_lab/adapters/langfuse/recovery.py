from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

from harness_lab.adapters.security.secretbox_codec import SecretBoxCodec

from .capabilities import negotiate_langfuse_capabilities
from .case_import_repository import LangfuseCaseImportRepository, LangfuseCaseImportResult
from .client import LangfuseClient

_SOURCE_REFERENCE_PREFIX = "langfuse"


def _resolve_codec() -> SecretBoxCodec:
    encoded = os.environ.get("HARNESS_MASTER_KEY")
    if not encoded:
        seed = os.environ.get("DATABASE_PATH", "harness-lab-local").encode("utf-8")
        encoded = base64.b64encode(hashlib.sha256(seed).digest()).decode("ascii")
    return SecretBoxCodec(encoded)


def _load_credentials(database: Any, connection_id: str) -> dict[str, str]:
    registration = database.prepare(
        "SELECT kind FROM connection_registrations WHERE id = ?"
    ).get(connection_id)
    if registration is None or str(registration[0]) != "langfuse":
        raise RuntimeError("CONNECTION_UNAVAILABLE")
    secret_row = database.prepare(
        "SELECT key_version, nonce, ciphertext FROM encrypted_secrets WHERE id = ?"
    ).get(connection_id)
    if secret_row is None:
        raise RuntimeError("CONNECTION_UNAVAILABLE")
    codec = _resolve_codec()
    decrypted = codec.decrypt(
        {
            "key_version": secret_row[0],
            "nonce": str(secret_row[1]),
            "ciphertext": str(secret_row[2]),
        }
    )
    credentials = json.loads(decrypted)
    if not isinstance(credentials, dict):
        raise RuntimeError("CONNECTION_UNAVAILABLE")
    return {str(key): str(value) for key, value in credentials.items()}


def build_recover_langfuse_cases(
    database: Any,
) -> Any:
    async def recover(request: dict[str, object]) -> LangfuseCaseImportResult:
        connection_id = str(request["connectionId"])
        credentials = _load_credentials(database, connection_id)
        base_url = credentials.get("baseUrl") or credentials.get("base_url")
        public_key = credentials.get("publicKey") or credentials.get("public_key")
        secret_key = credentials.get("secretKey") or credentials.get("secret_key")
        if not base_url or not public_key or not secret_key:
            raise RuntimeError("CONNECTION_UNAVAILABLE")

        client = LangfuseClient(
            base_url=base_url,
            public_key=public_key,
            secret_key=secret_key,
        )
        capabilities = await negotiate_langfuse_capabilities(client)
        repository = LangfuseCaseImportRepository(
            client=client,
            observations_api="legacy" if capabilities.observations_api == "legacy" else "v2",
            source_reference_prefix=f"{_SOURCE_REFERENCE_PREFIX}:{connection_id}",
        )
        limit_value = request["limit"]
        limit = int(limit_value) if isinstance(limit_value, (int, str)) else 0
        return await repository.import_cases(
            from_start_time=str(request["fromStartTime"]),
            to_start_time=str(request["toStartTime"]),
            limit=limit,
        )

    return recover
