from __future__ import annotations

import asyncio
import importlib.util
import os
import signal
from pathlib import Path
from uuid import uuid4

from harness_lab.adapters.sqlite import open_sqlite_database

from .config import resolve_worker_config
from .runtime import create_round_worker_runtime


async def start_worker(env: dict[str, str] | None = None) -> bool:
    effective_env = os.environ if env is None else env
    config = resolve_worker_config(effective_env)
    if config.provider_module is None:
        return False

    provider_path = Path(config.provider_module)
    spec = importlib.util.spec_from_file_location("worker_provider", provider_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("WORKER_PROVIDER_MODULE_INVALID")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    create_dependencies = getattr(module, "create_round_stage_dependencies", None)
    if not callable(create_dependencies):
        raise RuntimeError("WORKER_PROVIDER_MODULE_INVALID")

    provider_dependencies = create_dependencies(
        {
            "database_path": config.database_path,
            "encryption_key": config.encryption_key,
        }
    )

    Path(config.database_path).parent.mkdir(parents=True, exist_ok=True)
    database = open_sqlite_database(config.database_path)
    stopping = False

    def _stop(*_args: object) -> None:
        nonlocal stopping
        stopping = True

    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGINT, _stop)
    loop.add_signal_handler(signal.SIGTERM, _stop)

    try:
        runtime = create_round_worker_runtime(
            {
                "database": database,
                "worker_id": config.worker_id,
                "now": lambda: __import__("datetime").datetime.now(__import__("datetime").UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                "create_id": lambda: str(uuid4()),
                "stage_dependencies": provider_dependencies,
                "stage_options": {
                    "partition_seed": config.partition_seed,
                    "minimum_reserved": config.minimum_reserved,
                    "reserved_ratio": config.reserved_ratio,
                },
            }
        )
        while not stopping:
            processed = await runtime.tick()
            if not processed:
                await asyncio.sleep(config.poll_interval_ms / 1000)
        return True
    finally:
        database.close()


def main() -> int:
    try:
        started = asyncio.run(start_worker())
    except Exception:
        return 1
    return 0 if started else 0


if __name__ == "__main__":
    raise SystemExit(main())
