from __future__ import annotations

from harness_lab.adapters.provider_factory import create_round_stage_dependencies


def test_provider_factory_returns_none_when_unconfigured() -> None:
    provider = create_round_stage_dependencies({})
    assert provider is None


def test_provider_factory_requires_explicit_enablement() -> None:
    provider = create_round_stage_dependencies(
        {
            "agent_platform_base_url": "https://platform.example",
            "agent_platform_token": "token",
        }
    )
    assert provider is None
