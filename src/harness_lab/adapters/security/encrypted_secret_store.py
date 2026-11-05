from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from harness_lab.domain.ports import SecretStore, SecretValue

from ..sqlite.client import SqliteDatabase
from .secretbox_codec import SecretBoxCodec


class EncryptedSqliteSecretStore(SecretStore):
    def __init__(self, database: SqliteDatabase, codec: SecretBoxCodec) -> None:
        self._database = database
        self._codec = codec

    async def save(self, id: str, secret: SecretValue | dict[str, Any]) -> None:
        value = secret.value if isinstance(secret, SecretValue) else str(secret["value"])
        encrypted = self._codec.encrypt(value)
        self._database.prepare(
            """INSERT INTO encrypted_secrets
            (id, key_version, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              key_version = excluded.key_version,
              nonce = excluded.nonce,
              ciphertext = excluded.ciphertext,
              updated_at = excluded.updated_at"""
        ).run(
            id,
            encrypted["key_version"],
            encrypted["nonce"],
            encrypted["ciphertext"],
            datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        )

    async def get(self, id: str) -> SecretValue | None:
        row = self._database.prepare(
            "SELECT key_version, nonce, ciphertext FROM encrypted_secrets WHERE id = ?"
        ).get(id)
        if row is None:
            return None
        decrypted = self._codec.decrypt(
            {
                "key_version": row[0],
                "nonce": row[1],
                "ciphertext": row[2],
            }
        )
        return SecretValue(value=decrypted)

    async def rotate(self, id: str, secret: SecretValue | dict[str, Any]) -> None:
        await self.save(id, secret)

    async def delete(self, id: str) -> None:
        self._database.prepare("DELETE FROM encrypted_secrets WHERE id = ?").run(id)
