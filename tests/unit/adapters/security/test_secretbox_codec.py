from __future__ import annotations

import base64
import json

import pytest

from harness_lab.adapters.security.secretbox_codec import SecretBoxCodec


def test_encrypt_and_decrypt_roundtrip() -> None:
    codec = SecretBoxCodec("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    encrypted = codec.encrypt('{"publicKey":"pk","secretKey":"sk"}')

    assert encrypted["key_version"] == 1
    assert isinstance(encrypted["nonce"], str)
    assert isinstance(encrypted["ciphertext"], str)
    assert codec.decrypt(encrypted) == '{"publicKey":"pk","secretKey":"sk"}'


def test_rejects_non_canonical_or_invalid_master_key() -> None:
    with pytest.raises(ValueError, match="INVALID_ENCRYPTION_KEY"):
        SecretBoxCodec("invalid")

    key = base64.b64encode(b"0123456789abcdef0123456789abcdef").decode("ascii").rstrip("=")
    with pytest.raises(ValueError, match="INVALID_ENCRYPTION_KEY"):
        SecretBoxCodec(key)


def test_decrypt_rejects_corrupt_shape_and_wrong_key() -> None:
    codec = SecretBoxCodec("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    encrypted = codec.encrypt("secret")

    with pytest.raises(ValueError, match="SECRET_STORE_CORRUPT"):
        codec.decrypt({**encrypted, "key_version": 2})

    with pytest.raises(ValueError, match="SECRET_STORE_CORRUPT"):
        codec.decrypt({**encrypted, "nonce": "not-base64"})

    with pytest.raises(ValueError, match="SECRET_STORE_CORRUPT"):
        codec.decrypt({**encrypted, "ciphertext": "AA"})

    other = SecretBoxCodec("YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU=")
    with pytest.raises(ValueError, match="SECRET_DECRYPTION_FAILED"):
        other.decrypt(encrypted)


def test_codec_uses_secretbox_easy_shape_with_mac_prefix() -> None:
    codec = SecretBoxCodec("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    encrypted = codec.encrypt(json.dumps({"x": "y"}, separators=(",", ":")))
    ciphertext = codec.decode_base64(encrypted["ciphertext"])
    assert len(ciphertext) >= 16
