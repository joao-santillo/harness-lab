from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from nacl import secret, utils

from .client import SqliteDatabase


def _canonical_request(request: dict[str, Any]) -> str:
    credentials = dict(sorted(request["credentials"].items(), key=lambda item: item[0]))
    return json.dumps(
        {
            "id": request["id"],
            "kind": request["kind"],
            "name": request["name"],
            "credentials": credentials,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )


def _request_hash(request: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_request(request).encode("utf-8")).hexdigest()


class SqliteConnectionRegistrationStore:
    def __init__(self, database: SqliteDatabase, encoded_master_key: str) -> None:
        decoded = base64.b64decode(encoded_master_key.encode("ascii"), validate=True)
        if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != encoded_master_key:
            raise ValueError("INVALID_ENCRYPTION_KEY")
        self._database = database
        self._master_key = decoded

    async def find_replay(self, request: dict[str, Any]) -> dict[str, Any] | None:
        if request.get("idempotencyKey") is None:
            return None
        replay = self._database.prepare(
            "SELECT id, kind, name, request_hash FROM connection_registrations WHERE idempotency_key = ?"
        ).get(request["idempotencyKey"])
        if replay is None:
            return None
        if str(replay[3]) != _request_hash(request):
            raise ValueError("IDEMPOTENCY_CONFLICT")
        return {
            "status": "replayed",
            "connection": {
                "id": str(replay[0]),
                "kind": str(replay[1]),
                "name": str(replay[2]),
                "configured": True,
            },
        }

    async def register(self, request: dict[str, Any]) -> dict[str, Any]:
        encrypted = self._encrypt(json.dumps(request["credentials"], separators=(",", ":")))
        request_hash = _request_hash(request)

        def operation() -> dict[str, Any]:
            idempotency_key = request.get("idempotencyKey")
            if idempotency_key is not None:
                replay = self._database.prepare(
                    "SELECT id, kind, name, request_hash FROM connection_registrations WHERE idempotency_key = ?"
                ).get(idempotency_key)
                if replay is not None:
                    if str(replay[3]) != request_hash:
                        raise ValueError("IDEMPOTENCY_CONFLICT")
                    return {
                        "status": "replayed",
                        "connection": {
                            "id": str(replay[0]),
                            "kind": str(replay[1]),
                            "name": str(replay[2]),
                            "configured": True,
                        },
                    }

            now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            self._database.prepare(
                """INSERT INTO encrypted_secrets
                (id, key_version, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET key_version = excluded.key_version, nonce = excluded.nonce,
                  ciphertext = excluded.ciphertext, updated_at = excluded.updated_at"""
            ).run(
                request["id"],
                encrypted["keyVersion"],
                encrypted["nonce"],
                encrypted["ciphertext"],
                now,
            )
            self._database.prepare(
                """INSERT INTO connection_registrations
                (id, kind, name, idempotency_key, request_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
                  idempotency_key = excluded.idempotency_key, request_hash = excluded.request_hash,
                  updated_at = excluded.updated_at"""
            ).run(
                request["id"],
                request["kind"],
                request["name"],
                request.get("idempotencyKey"),
                request_hash,
                now,
                now,
            )
            return {
                "status": "created",
                "connection": {
                    "id": request["id"],
                    "kind": request["kind"],
                    "name": request["name"],
                    "configured": True,
                },
            }

        return self._database.transaction(operation)()

    def _encrypt(self, value: str) -> dict[str, Any]:
        box = secret.SecretBox(self._master_key)
        nonce = utils.random(secret.SecretBox.NONCE_SIZE)
        encrypted = box.encrypt(value.encode("utf-8"), nonce=nonce)
        return {
            "keyVersion": 1,
            "nonce": base64.b64encode(nonce).decode("ascii"),
            "ciphertext": base64.b64encode(encrypted.ciphertext).decode("ascii"),
        }
