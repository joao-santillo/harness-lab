from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from harness_lab.worker import main as worker_main


def _run(coroutine: object) -> object:
    return asyncio.run(coroutine)


def _valid_env(*, provider_module: str | None) -> dict[str, str]:
    env = {
        "APP_ENCRYPTION_KEY": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    }
    if provider_module is not None:
        env["WORKER_PROVIDER_MODULE"] = provider_module
    return env


def test_start_worker_returns_false_without_provider_and_does_not_open_database(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail_open(_path: str) -> object:
        raise AssertionError("database must not open when provider is absent")

    monkeypatch.setattr(worker_main, "open_sqlite_database", _fail_open)

    started = _run(worker_main.start_worker(_valid_env(provider_module=None)))

    assert started is False


def test_start_worker_rejects_invalid_provider_module_without_opening_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fail_open(_path: str) -> object:
        raise AssertionError("database must not open when provider module is invalid")

    monkeypatch.setattr(worker_main, "open_sqlite_database", _fail_open)

    with pytest.raises(RuntimeError, match="WORKER_PROVIDER_MODULE_INVALID"):
        _run(
            worker_main.start_worker(
                _valid_env(provider_module="./provider-does-not-exist.py")
            )
        )


def test_start_worker_awaits_async_provider_factory_and_passes_stage_options(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_file = tmp_path / "provider.py"
    provider_file.write_text(
        "import asyncio\n"
        "\n"
        "async def create_round_stage_dependencies(config):\n"
        "    await asyncio.sleep(0)\n"
        "    return {'marker': config['database_path']}\n",
        encoding="utf-8",
    )

    class _FakeDatabase:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    class _FakeLoop:
        def add_signal_handler(self, _sig: object, callback: object) -> None:
            callback()

    class _Runtime:
        async def tick(self) -> bool:
            raise AssertionError("tick should not run when stop signal is already set")

    fake_database = _FakeDatabase()
    captured: dict[str, object] = {}

    def _open_database(_path: str) -> _FakeDatabase:
        return fake_database

    def _create_runtime(options: dict[str, object]) -> _Runtime:
        captured["stage_dependencies"] = options["stage_dependencies"]
        captured["stage_options"] = options["stage_options"]
        return _Runtime()

    monkeypatch.setattr(worker_main, "open_sqlite_database", _open_database)
    monkeypatch.setattr(worker_main, "create_round_worker_runtime", _create_runtime)
    monkeypatch.setattr(worker_main.asyncio, "get_running_loop", lambda: _FakeLoop())

    started = _run(
        worker_main.start_worker(
            {
                **_valid_env(provider_module=str(provider_file)),
                "ROUND_MAX_PROPOSALS": "9",
            }
        )
    )

    assert started is True
    assert fake_database.closed is True
    assert captured["stage_options"] == {
        "partition_seed": "round-partition-v1",
        "minimum_reserved": 1,
        "reserved_ratio": 0.2,
        "max_proposals": 9,
    }
    assert captured["stage_dependencies"] == {"marker": captured["stage_dependencies"]["marker"]}
    assert str(captured["stage_dependencies"]["marker"]).endswith("/data/harness.sqlite")


def test_start_worker_closes_database_when_runtime_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_file = tmp_path / "provider_sync.py"
    provider_file.write_text(
        "def create_round_stage_dependencies(_config):\n"
        "    return {}\n",
        encoding="utf-8",
    )

    class _FakeDatabase:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    class _FakeLoop:
        def add_signal_handler(self, _sig: object, _callback: object) -> None:
            return None

    class _Runtime:
        async def tick(self) -> bool:
            raise RuntimeError("runtime boom")

    fake_database = _FakeDatabase()

    monkeypatch.setattr(worker_main, "open_sqlite_database", lambda _path: fake_database)
    monkeypatch.setattr(worker_main, "create_round_worker_runtime", lambda _options: _Runtime())
    monkeypatch.setattr(worker_main.asyncio, "get_running_loop", lambda: _FakeLoop())

    with pytest.raises(RuntimeError, match="runtime boom"):
        _run(worker_main.start_worker(_valid_env(provider_module=str(provider_file))))

    assert fake_database.closed is True
