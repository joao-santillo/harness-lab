from __future__ import annotations

import json
from pathlib import Path

from harness_lab.adapters.security.secretbox_codec import SecretBoxCodec


def _fixture() -> dict[str, object]:
    return json.loads(
        Path("tests/contracts/fixtures/security/secretbox-v1.json").read_text(encoding="utf-8")
    )


def test_decrypts_typescript_libsodium_fixture_exactly() -> None:
    fixture = _fixture()
    codec = SecretBoxCodec(str(fixture["key_b64"]))
    decrypted = codec.decrypt(
        {
            "key_version": fixture["key_version"],
            "nonce": fixture["nonce_b64"],
            "ciphertext": fixture["ciphertext_b64"],
        }
    )
    assert json.loads(decrypted) == fixture["credentials"]


def test_encrypts_with_fixed_nonce_to_match_fixture_bytes() -> None:
    fixture = _fixture()
    codec = SecretBoxCodec(str(fixture["key_b64"]))
    plaintext = json.dumps(fixture["credentials"], separators=(",", ":"), ensure_ascii=False)

    encrypted = codec.encrypt(
        plaintext,
        nonce=codec.decode_base64(str(fixture["nonce_b64"])),
    )

    assert encrypted["key_version"] == fixture["key_version"]
    assert encrypted["nonce"] == fixture["nonce_b64"]
    assert encrypted["ciphertext"] == fixture["ciphertext_b64"]
