from __future__ import annotations

from harness_lab.adapters.security.redactor import create_redactor


def test_redacts_sensitive_keys_recursively_without_mutation() -> None:
    payload = {
        "authorization": "Bearer abc",
        "nested": {"apiKey": "public", "password": "password", "stableCode": "CONNECTION_FAILED"},
    }

    output = create_redactor()(payload)

    assert output == {
        "authorization": "[REDACTED]",
        "nested": {"apiKey": "[REDACTED]", "password": "[REDACTED]", "stableCode": "CONNECTION_FAILED"},
    }
    assert payload["authorization"] == "Bearer abc"


def test_redacts_configured_values_and_credential_urls() -> None:
    redact = create_redactor(["known-secret"])
    output = redact(
        {
            "message": "request failed for known-secret",
            "url": "https://user:password@example.com/path?token=query-token&safe=yes",
        }
    )
    assert output == {
        "message": "request failed for [REDACTED]",
        "url": "https://%5BREDACTED%5D@example.com/path?token=%5BREDACTED%5D&safe=yes",
    }


def test_handles_arrays_cycles_exceptions_and_percent_encoded_values() -> None:
    redact = create_redactor(["a/b c"])
    input_obj: dict[str, object] = {"token": "abc", "values": ["safe"]}
    input_obj["self"] = input_obj

    error = RuntimeError("failed at https://user:pass@example.com/path?access_token=abc")
    error.code = "CONNECTION_FAILED"  # type: ignore[attr-defined]

    output = redact(
        {
            "cycle": input_obj,
            "error": error,
            "query": "https://example.com/?value=a%2Fb%20c",
            "path": "https://example.com/a%2Fb%20c",
            "user": "https://a%2Fb%20c@example.com/",
        }
    )

    assert output["cycle"]["token"] == "[REDACTED]"
    assert output["cycle"]["self"] is output["cycle"]
    assert output["error"]["message"] == (
        "failed at https://%5BREDACTED%5D@example.com/path?access_token=%5BREDACTED%5D"
    )
    assert output["error"]["code"] == "CONNECTION_FAILED"
    assert output["query"] == "https://example.com/?value=[REDACTED]"
    assert output["path"] == "https://example.com/[REDACTED]"
    assert output["user"] == "https://%5BREDACTED%5D@example.com/"
