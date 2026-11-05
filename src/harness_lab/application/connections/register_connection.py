from __future__ import annotations

from typing import Literal, Protocol

from harness_lab.domain.models import DomainModel

ConnectionKind = Literal["langfuse", "agent-platform"]


class ConnectionView(DomainModel):
    id: str
    kind: ConnectionKind
    name: str
    configured: bool


class RegisterConnectionRequest(DomainModel):
    id: str
    kind: ConnectionKind
    name: str
    credentials: dict[str, str]
    idempotency_key: str | None


class ConnectionTestError(RuntimeError):
    def __init__(
        self,
        code: Literal["CONNECTION_AUTH_FAILED", "CONNECTION_UNAVAILABLE"],
    ) -> None:
        self.code = code
        super().__init__(code)


class RegistrationResult(DomainModel):
    status: Literal["created", "replayed"]
    connection: ConnectionView


class ConnectionTester(Protocol):
    async def test(self, request: dict[str, object]) -> None: ...


class ConnectionRegistrationStore(Protocol):
    async def find_replay(self, request: dict[str, object]) -> dict[str, object] | None: ...

    async def register(self, request: dict[str, object]) -> dict[str, object]: ...


class RegisterConnection:
    def __init__(
        self,
        tester: ConnectionTester,
        store: ConnectionRegistrationStore,
    ) -> None:
        self._tester = tester
        self._store = store

    async def execute(
        self,
        request: RegisterConnectionRequest | dict[str, object],
    ) -> RegistrationResult:
        parsed_request = (
            request
            if isinstance(request, RegisterConnectionRequest)
            else RegisterConnectionRequest.model_validate(request)
        )
        payload = parsed_request.model_dump(by_alias=True)

        replay = await self._store.find_replay(payload)
        if replay is not None:
            return RegistrationResult.model_validate(replay)

        await self._tester.test(
            {
                "kind": parsed_request.kind,
                "credentials": dict(parsed_request.credentials),
            }
        )
        result = await self._store.register(payload)
        return RegistrationResult.model_validate(result)
