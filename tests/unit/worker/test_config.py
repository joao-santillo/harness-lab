from __future__ import annotations

from pathlib import Path

import pytest

from harness_lab.worker.config import resolve_worker_config


def test_worker_config_requires_valid_encryption_key() -> None:
    with pytest.raises(ValueError, match="APP_ENCRYPTION_KEY_INVALID"):
        resolve_worker_config({})


def test_worker_config_provider_module_is_optional_and_defaults_are_applied(tmp_path: Path) -> None:
    config = resolve_worker_config(
        {
            "APP_ENCRYPTION_KEY": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        },
        base_dir=str(tmp_path),
    )

    assert config.provider_module is None
    assert config.worker_id.startswith("worker-")
    assert config.poll_interval_ms == 1000
    assert config.minimum_reserved == 1
    assert config.max_proposals == 3


def test_worker_config_resolves_provider_module_when_present(tmp_path: Path) -> None:
    key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    config = resolve_worker_config(
        {
            "APP_ENCRYPTION_KEY": key,
            "WORKER_PROVIDER_MODULE": "./provider.py",
            "WORKER_ID": "worker-test",
            "WORKER_POLL_INTERVAL_MS": "250",
            "ROUND_RESERVED_RATIO": "0.2",
        },
        base_dir=str(tmp_path),
    )

    assert config.encryption_key == key
    assert config.worker_id == "worker-test"
    assert config.provider_module == str((tmp_path / "provider.py").resolve())
    assert config.database_path.endswith("harness.sqlite")
