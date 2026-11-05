from __future__ import annotations

import base64
from typing import Any, Mapping

from nacl import exceptions, secret, utils


class SecretBoxCodec:
    def __init__(self, encoded_master_key: str) -> None:
        try:
            decoded = base64.b64decode(encoded_master_key.encode("ascii"), validate=True)
        except Exception as error:  # pragma: no cover - normalized below
            raise ValueError("INVALID_ENCRYPTION_KEY") from error
        if len(decoded) != 32:
            raise ValueError("INVALID_ENCRYPTION_KEY")
        if base64.b64encode(decoded).decode("ascii") != encoded_master_key:
            raise ValueError("INVALID_ENCRYPTION_KEY")
        self._master_key = decoded

    @staticmethod
    def decode_base64(value: str) -> bytes:
        try:
            raw = value.encode("ascii")
            padded = raw + b"=" * ((4 - (len(raw) % 4)) % 4)
            return base64.b64decode(padded, validate=True)
        except Exception as error:
            raise ValueError("SECRET_STORE_CORRUPT") from error

    @staticmethod
    def _encode_base64(value: bytes) -> str:
        return base64.b64encode(value).decode("ascii").rstrip("=")

    def encrypt(self, value: str, *, nonce: bytes | None = None) -> dict[str, Any]:
        actual_nonce = nonce if nonce is not None else utils.random(secret.SecretBox.NONCE_SIZE)
        if len(actual_nonce) != secret.SecretBox.NONCE_SIZE:
            raise ValueError("SECRET_STORE_CORRUPT")
        box = secret.SecretBox(self._master_key)
        encrypted = box.encrypt(value.encode("utf-8"), nonce=actual_nonce)
        return {
            "key_version": 1,
            "nonce": self._encode_base64(actual_nonce),
            "ciphertext": self._encode_base64(encrypted.ciphertext),
        }

    def decrypt(self, encrypted: Mapping[str, object]) -> str:
        try:
            key_version = encrypted["key_version"]
            nonce_encoded = encrypted["nonce"]
            ciphertext_encoded = encrypted["ciphertext"]
        except Exception as error:
            raise ValueError("SECRET_STORE_CORRUPT") from error

        if int(key_version) != 1:
            raise ValueError("SECRET_STORE_CORRUPT")
        if not isinstance(nonce_encoded, str) or not isinstance(ciphertext_encoded, str):
            raise ValueError("SECRET_STORE_CORRUPT")

        nonce = self.decode_base64(nonce_encoded)
        ciphertext = self.decode_base64(ciphertext_encoded)
        if len(nonce) != secret.SecretBox.NONCE_SIZE or len(ciphertext) < secret.SecretBox.MACBYTES:
            raise ValueError("SECRET_STORE_CORRUPT")

        box = secret.SecretBox(self._master_key)
        try:
            decrypted = box.decrypt(ciphertext, nonce)
        except exceptions.CryptoError as error:
            raise ValueError("SECRET_DECRYPTION_FAILED") from error
        return decrypted.decode("utf-8")
