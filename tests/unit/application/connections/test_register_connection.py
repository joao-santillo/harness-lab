from __future__ import annotations

import asyncio

import pytest

from harness_lab.application.connections.register_connection import (
    ConnectionTestError,
    RegisterConnection,
)

REQUEST = {
    "id": "langfuse-main",
    "kind": "langfuse",
    "name": "Langfuse principal",
    "credentials": {"publicKey": "pk-live", "secretKey": "sk-live"},
    "idempotency_key": "request-1",
}


def test_register_connection_tests_before_registering() -> None:
    calls: list[str] = []

    class Tester:
        async def test(self, request: dict[str, object]) -> None:
            calls.append("test")

    class Store:
        async def find_replay(self, request: dict[str, object]) -> dict[str, object] | None:
            calls.append("find_replay")
            return None

        async def register(self, request: dict[str, object]) -> dict[str, object]:
            calls.append("register")
            return {
                "status": "created",
                "connection": {
                    "id": str(request["id"]),
                    "kind": str(request["kind"]),
                    "name": str(request["name"]),
                    "configured": True,
                },
            }

    result = asyncio.run(RegisterConnection(Tester(), Store()).execute(REQUEST))

    assert calls == ["find_replay", "test", "register"]
    assert result.status == "created"


def test_register_connection_never_persists_when_test_fails() -> None:
    persisted = False

    class Tester:
        async def test(self, request: dict[str, object]) -> None:
            raise ConnectionTestError("CONNECTION_AUTH_FAILED")

    class Store:
        async def find_replay(self, request: dict[str, object]) -> dict[str, object] | None:
            return None

        async def register(self, request: dict[str, object]) -> dict[str, object]:
            nonlocal persisted
            persisted = True
            raise RuntimeError("unexpected")

    with pytest.raises(ConnectionTestError, match="CONNECTION_AUTH_FAILED"):
        asyncio.run(RegisterConnection(Tester(), Store()).execute(REQUEST))
    assert persisted is False


def test_register_connection_replays_without_retesting() -> None:
    tested = False

    class Tester:
        async def test(self, request: dict[str, object]) -> None:
            nonlocal tested
            tested = True

    class Store:
        async def find_replay(self, request: dict[str, object]) -> dict[str, object] | None:
            return {
                "status": "replayed",
                "connection": {
                    "id": REQUEST["id"],
                    "kind": REQUEST["kind"],
                    "name": REQUEST["name"],
                    "configured": True,
                },
            }

        async def register(self, request: dict[str, object]) -> dict[str, object]:
            raise RuntimeError("unexpected")

    result = asyncio.run(RegisterConnection(Tester(), Store()).execute(REQUEST))
    assert result.status == "replayed"
    assert tested is False


@pytest.mark.parametrize(
    ("code",),
    [
        ("CONNECTION_AUTH_FAILED",),
        ("CONNECTION_UNAVAILABLE",),
    ],
)
def test_connection_test_error_exposes_stable_codes(code: str) -> None:
    error = ConnectionTestError(code)
    assert error.code == code
    assert str(error) == code