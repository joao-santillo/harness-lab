from __future__ import annotations

import pytest

from harness_lab.adapters.agent_platform.capabilities import map_agent_capabilities


def test_map_agent_capabilities_filters_unknown_editable_fields() -> None:
    capabilities = map_agent_capabilities(
        {
            "editable": ["dta-flow", "tools", "unknown-component"],
            "supportsSeed": True,
            "supportsToolReplay": False,
            "apiVersion": "2026-10",
            "futureField": {"keep": "opaque-in-raw-only"},
        }
    )
    assert capabilities.editable_components == ("dta-flow", "tools")
    assert capabilities.supports_seed is True
    assert capabilities.supports_tool_replay is False
    assert capabilities.api_version == "2026-10"


def test_map_agent_capabilities_defaults_support_flags_false() -> None:
    capabilities = map_agent_capabilities({"editable": [], "apiVersion": "2026-10"})
    assert capabilities.supports_seed is False
    assert capabilities.supports_tool_replay is False


def test_map_agent_capabilities_requires_api_version() -> None:
    with pytest.raises(ValueError):
        map_agent_capabilities({"editable": []})
