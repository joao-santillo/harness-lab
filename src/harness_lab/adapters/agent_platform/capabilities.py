from __future__ import annotations

from harness_lab.domain.ports import AgentCapabilities

_EDITABLE_COMPONENTS = (
    "dta-flow",
    "tools",
    "parameters",
    "knowledge",
    "memory",
    "records",
)


class DiscoveredAgentCapabilities(AgentCapabilities):
    api_version: str


def map_agent_capabilities(input_data: object) -> DiscoveredAgentCapabilities:
    if not isinstance(input_data, dict):
        raise ValueError("AGENT_PLATFORM_CAPABILITIES_INVALID")

    editable_raw = input_data.get("editable")
    api_version = input_data.get("apiVersion")
    if not isinstance(editable_raw, list) or not isinstance(api_version, str):
        raise ValueError("AGENT_PLATFORM_CAPABILITIES_INVALID")

    editable = tuple(
        component
        for component in _EDITABLE_COMPONENTS
        if component in editable_raw
    )
    supports_seed = bool(input_data.get("supportsSeed", False))
    supports_tool_replay = bool(input_data.get("supportsToolReplay", False))

    return DiscoveredAgentCapabilities(
        editable_components=editable,
        supports_seed=supports_seed,
        supports_tool_replay=supports_tool_replay,
        api_version=api_version,
    )
