from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class WorkerConfig:
    encryption_key: str
    database_path: str
    provider_module: str | None
    worker_id: str
    poll_interval_ms: int
    partition_seed: str
    minimum_reserved: int
    reserved_ratio: float
    max_proposals: int


def _valid_key(value: str | None) -> str:
    if value is None:
        raise ValueError("APP_ENCRYPTION_KEY_INVALID")
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as error:
        raise ValueError("APP_ENCRYPTION_KEY_INVALID") from error
    if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != value:
        raise ValueError("APP_ENCRYPTION_KEY_INVALID")
    return value


def _integer(value: str | None, fallback: int, min_value: int, max_value: int, code: str) -> int:
    if value is None:
        return fallback
    parsed = int(value)
    if parsed < min_value or parsed > max_value:
        raise ValueError(code)
    return parsed


def resolve_worker_config(env: dict[str, str] | os._Environ[str], base_dir: str | None = None) -> WorkerConfig:
    encryption_key = _valid_key(env.get("APP_ENCRYPTION_KEY"))
    resolved_base_dir = Path(base_dir or Path.cwd())
    provider = env.get("WORKER_PROVIDER_MODULE")
    provider_module = (
        None if not provider else str((resolved_base_dir / provider).resolve())
    )

    data_dir_raw = env.get("APP_DATA_DIR", "./data")
    data_dir = Path(data_dir_raw)
    if not data_dir.is_absolute():
        data_dir = (PROJECT_ROOT / data_dir).resolve()

    reserved_ratio = float(env.get("ROUND_RESERVED_RATIO", "0.2"))
    if reserved_ratio <= 0 or reserved_ratio >= 1:
        raise ValueError("ROUND_RESERVED_RATIO_INVALID")

    return WorkerConfig(
        encryption_key=encryption_key,
        database_path=str(data_dir / "harness.sqlite"),
        provider_module=provider_module,
        worker_id=env.get("WORKER_ID", f"worker-{os.getpid()}"),
        poll_interval_ms=_integer(
            env.get("WORKER_POLL_INTERVAL_MS"),
            1000,
            100,
            60_000,
            "WORKER_POLL_INTERVAL_INVALID",
        ),
        partition_seed=env.get("ROUND_PARTITION_SEED", "round-partition-v1"),
        minimum_reserved=_integer(
            env.get("ROUND_MINIMUM_RESERVED"),
            1,
            1,
            100,
            "ROUND_MINIMUM_RESERVED_INVALID",
        ),
        reserved_ratio=reserved_ratio,
        max_proposals=_integer(
            env.get("ROUND_MAX_PROPOSALS"),
            3,
            1,
            20,
            "ROUND_MAX_PROPOSALS_INVALID",
        ),
    )
