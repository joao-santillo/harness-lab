from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any

from harness_lab.domain.models.harness import HarnessSnapshot, HarnessSnapshotId
from harness_lab.domain.models.round import AgentId, DomainId
from harness_lab.domain.ports import AgentCapabilities, AgentHarnessRepository

from .capabilities import map_agent_capabilities
from .client import AgentPlatformClient


def _deep_immutable(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _deep_immutable(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_deep_immutable(item) for item in value)
    return value


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class AgentPlatformHarnessRepository(AgentHarnessRepository):
    def __init__(self, client: AgentPlatformClient, now: Callable[[], str] = _now_iso) -> None:
        self._client = client
        self._now = now
        self._snapshots: dict[HarnessSnapshotId, HarnessSnapshot] = {}

    async def get_capabilities(self, agent_id: AgentId) -> AgentCapabilities:
        response = await self._client.request(f"/api/agents/{agent_id}/capabilities")
        payload = await self._json_or_stable_error(response)
        return map_agent_capabilities(payload)

    async def fetch_snapshot(self, agent_id: AgentId, domain_id: DomainId) -> HarnessSnapshot:
        response = await self._client.request(f"/api/agents/{agent_id}/harness")
        raw = await self._json_or_stable_error(response)
        if not isinstance(raw, dict):
            raise RuntimeError("AGENT_PLATFORM_REQUEST_FAILED")
        if not isinstance(raw.get("version"), str):
            raise RuntimeError("AGENT_PLATFORM_REQUEST_FAILED")

        canonical = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
        components: dict[str, str] = {}
        mappings = (
            ("dta-flow", raw.get("dtaFlow")),
            ("tools", raw.get("tools")),
            ("parameters", raw.get("parameters")),
            ("knowledge", raw.get("knowledge")),
            ("memory", raw.get("memory")),
            ("records", raw.get("records")),
        )
        for name, value in mappings:
            if value is not None:
                components[name] = json.dumps(value, ensure_ascii=False, separators=(",", ":"))

        immutable_rules = raw.get("immutableRules", [])
        if not isinstance(immutable_rules, list) or not all(isinstance(item, str) for item in immutable_rules):
            immutable_rules = []

        return HarnessSnapshot(
            id=HarnessSnapshotId(f"{agent_id}:{raw['version']}"),
            agent_id=agent_id,
            domain_id=domain_id,
            version=raw["version"],
            components=MappingProxyType(components),
            immutable_constraints=tuple(immutable_rules),
            created_at=self._now(),
            source_version=raw["version"],
            artifact_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            opaque_payload=_deep_immutable(copy.deepcopy(raw)),
        )

    async def get_snapshot(self, id: HarnessSnapshotId) -> HarnessSnapshot | None:
        return self._snapshots.get(id)

    async def save_snapshot(self, snapshot: HarnessSnapshot) -> None:
        self._snapshots[snapshot.id] = snapshot.model_copy(deep=True)

    async def _json_or_stable_error(self, response: Any) -> Any:
        if response.status_code in {401, 403}:
            raise RuntimeError("AGENT_PLATFORM_INVALID_CREDENTIALS")
        if not response.is_success:
            raise RuntimeError("AGENT_PLATFORM_REQUEST_FAILED")
        return response.json()
