from __future__ import annotations

from pathlib import Path

MIGRATION_FILES: tuple[Path, ...] = (
    Path(__file__).with_name("migrations") / "0001_foundation.sql",
    Path(__file__).with_name("migrations") / "0002_immutable_harness.sql",
    Path(__file__).with_name("migrations") / "0003_scope_integrity.sql",
    Path(__file__).with_name("migrations") / "0004_encrypted_secrets.sql",
    Path(__file__).with_name("migrations") / "0005_connection_registrations.sql",
    Path(__file__).with_name("migrations") / "0006_round_jobs.sql",
    Path(__file__).with_name("migrations") / "0007_round_artifacts.sql",
    Path(__file__).with_name("migrations") / "0008_round_job_cancellation_leases.sql",
)
