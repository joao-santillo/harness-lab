from __future__ import annotations

from datetime import datetime, timedelta

from .client import SqliteDatabase


class SqliteRoundJobStore:
    def __init__(self, database: SqliteDatabase, lease_ms: int = 30_000) -> None:
        self._database = database
        self._lease_ms = lease_ms

    def enqueue(self, round_id: str, now: str) -> None:
        self._database.prepare(
            """INSERT INTO round_jobs
            (round_id, status, claimed_by, claimed_at, created_at, updated_at)
            VALUES (?, 'queued', NULL, NULL, ?, ?)"""
        ).run(round_id, now, now)

    def claim_next(self, worker_id: str, now: str) -> dict[str, str] | None:
        def operation() -> dict[str, str] | None:
            lease_cutoff = (datetime.fromisoformat(now.replace("Z", "+00:00")) - timedelta(milliseconds=self._lease_ms)).isoformat().replace("+00:00", "Z")
            candidate = self._database.prepare(
                """SELECT round_id FROM round_jobs
                 WHERE status = 'queued'
                   OR (status = 'cancel_requested' AND claimed_by IS NULL)
                   OR (status IN ('claimed', 'cancel_requested') AND claimed_at < ?)
                 ORDER BY created_at, round_id LIMIT 1"""
            ).get(lease_cutoff)
            if candidate is None:
                return None

            claimed = self._database.prepare(
                """UPDATE round_jobs
                SET status = CASE WHEN status = 'cancel_requested' THEN status ELSE 'claimed' END,
                    claimed_by = ?, claimed_at = ?, updated_at = ?
                WHERE round_id = ? AND (
                  status = 'queued'
                  OR (status = 'cancel_requested' AND claimed_by IS NULL)
                  OR (status IN ('claimed', 'cancel_requested') AND claimed_at < ?)
                )
                RETURNING round_id"""
            ).get(worker_id, now, now, str(candidate[0]), lease_cutoff)
            if claimed is None:
                return None
            return {
                "roundId": str(claimed[0]),
                "status": "claimed",
                "claimedBy": worker_id,
            }

        return self._database.transaction(operation)()

    def request_cancellation(self, round_id: str, now: str) -> bool:
        row = self._database.prepare(
            """UPDATE round_jobs
            SET status = 'cancel_requested', updated_at = ?
            WHERE round_id = ? AND status IN ('queued', 'claimed')
            RETURNING round_id"""
        ).get(now, round_id)
        return row is not None

    async def is_cancellation_requested(self, round_id: str) -> bool:
        row = self._database.prepare(
            "SELECT round_id FROM round_jobs WHERE round_id = ? AND status = 'cancel_requested'"
        ).get(round_id)
        return row is not None

    async def is_owned_by(self, round_id: str, worker_id: str) -> bool:
        row = self._database.prepare(
            """SELECT round_id FROM round_jobs
            WHERE round_id = ? AND status IN ('claimed', 'cancel_requested') AND claimed_by = ?"""
        ).get(round_id, worker_id)
        return row is not None

    async def complete(self, round_id: str, worker_id: str) -> bool:
        row = self._database.prepare(
            """DELETE FROM round_jobs
            WHERE round_id = ? AND status IN ('claimed', 'cancel_requested') AND claimed_by = ?
            RETURNING round_id"""
        ).get(round_id, worker_id)
        return row is not None

    def remove(self, round_id: str) -> None:
        self._database.prepare("DELETE FROM round_jobs WHERE round_id = ?").run(round_id)
