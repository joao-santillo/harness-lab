from __future__ import annotations

import hashlib
import json
from pathlib import Path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_migration_files_match_expected_checksums_and_original_bytes() -> None:
    root = Path(__file__).resolve().parents[2]
    source_dir = root / "packages" / "adapters" / "src" / "sqlite" / "migrations"
    python_dir = root / "src" / "harness_lab" / "adapters" / "sqlite" / "migrations"
    fixture_path = root / "tests" / "contracts" / "fixtures" / "sqlite" / "migration-checksums.json"

    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(fixture, dict)
    assert sorted(fixture.keys()) == [
        "0001_foundation.sql",
        "0002_immutable_harness.sql",
        "0003_scope_integrity.sql",
        "0004_encrypted_secrets.sql",
        "0005_connection_registrations.sql",
        "0006_round_jobs.sql",
        "0007_round_artifacts.sql",
        "0008_round_job_cancellation_leases.sql",
    ]

    for filename, expected_checksum in fixture.items():
        source = source_dir / filename
        copied = python_dir / filename
        assert copied.read_bytes() == source.read_bytes()
        assert _sha256(source) == expected_checksum
        assert _sha256(copied) == expected_checksum