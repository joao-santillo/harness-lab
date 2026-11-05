from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from harness_lab.adapters.security.encrypted_secret_store import EncryptedSqliteSecretStore
from harness_lab.adapters.security.secretbox_codec import SecretBoxCodec
from harness_lab.adapters.sqlite.client import open_sqlite_database
from harness_lab.domain.ports import SecretValue


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def test_save_get_rotate_delete_and_plaintext_absent(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    codec = SecretBoxCodec("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    store = EncryptedSqliteSecretStore(database, codec)

    value = '{"publicKey":"pk-live","secretKey":"sk-live"}'
    _run(store.save("langfuse-main", SecretValue(value=value)))

    persisted = (tmp_path / "harness.sqlite").read_bytes()
    assert b"pk-live" not in persisted
    assert b"sk-live" not in persisted

    assert _run(store.get("langfuse-main")) == SecretValue(value=value)
    _run(store.rotate("langfuse-main", SecretValue(value="second")))
    assert _run(store.get("langfuse-main")) == SecretValue(value="second")
    _run(store.delete("langfuse-main"))
    assert _run(store.get("langfuse-main")) is None
    database.close()


def test_corrupt_storage_and_wrong_key_raise_stable_errors(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    codec = SecretBoxCodec("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    store = EncryptedSqliteSecretStore(database, codec)
    _run(store.save("langfuse-main", SecretValue(value="secret")))

    database.prepare("UPDATE encrypted_secrets SET key_version = ? WHERE id = ?").run(2, "langfuse-main")
    with pytest.raises(ValueError, match="SECRET_STORE_CORRUPT"):
        _run(store.get("langfuse-main"))

    database.prepare("UPDATE encrypted_secrets SET key_version = 1, nonce = ?, ciphertext = ? WHERE id = ?").run(
        "invalid",
        "AA",
        "langfuse-main",
    )
    with pytest.raises(ValueError, match="SECRET_STORE_CORRUPT"):
        _run(store.get("langfuse-main"))

    _run(store.save("langfuse-main", SecretValue(value="secret-2")))

    database.close()

    db2 = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    wrong = EncryptedSqliteSecretStore(
        db2,
        SecretBoxCodec("YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU="),
    )
    with pytest.raises(ValueError, match="SECRET_DECRYPTION_FAILED"):
        _run(wrong.get("langfuse-main"))
    db2.close()
