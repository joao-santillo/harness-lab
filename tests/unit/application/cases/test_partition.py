from __future__ import annotations

import asyncio

import pytest

from harness_lab.application.cases.partition_cases import (
    assert_learning_sources,
    partition_cases,
    run_refinement_with_diagnosis_cases,
    seal_partition_manifest,
)
from harness_lab.domain import PartitionCase, PartitionManifest, PartitionOptions

CASES = (
    PartitionCase(id="a1", session_id="session-a", similarity_group="billing", content="invoice one"),
    PartitionCase(id="a2", session_id="session-a", similarity_group="billing", content="invoice two"),
    PartitionCase(id="b1", session_id="session-b", similarity_group="refund", content="refund one"),
    PartitionCase(id="c1", session_id="session-c", similarity_group="refund", content="refund two"),
    PartitionCase(id="d1", session_id="session-d", similarity_group="shipping", content="shipping one"),
    PartitionCase(id="e1", session_id="session-e", similarity_group="account", content="account one"),
)


def test_partition_keeps_transitive_groups_deterministic_and_disjoint() -> None:
    first = partition_cases(
        CASES,
        PartitionOptions(seed="round-17", minimum_reserved=2, reserved_ratio=0.34),
    )
    second = partition_cases(
        CASES,
        PartitionOptions(seed="round-17", minimum_reserved=2, reserved_ratio=0.34),
    )

    assert second == first
    assert len(first.reserved_ids) >= 2
    assert [id_ for id_ in first.diagnosis_ids if id_ in first.reserved_ids] == []
    assert set((*first.diagnosis_ids, *first.reserved_ids)) == {case.id for case in CASES}
    assert ("a1" in first.reserved_ids) is ("a2" in first.reserved_ids)
    assert ("b1" in first.reserved_ids) is ("c1" in first.reserved_ids)


def test_partition_exposes_only_diagnosis_cases_to_refinement() -> None:
    manifest = partition_cases(
        CASES,
        PartitionOptions(seed="round-17", minimum_reserved=2, reserved_ratio=0.34),
    )

    calls: list[tuple[dict[str, str], ...]] = []

    async def refinement(visible_cases: tuple[dict[str, str], ...]) -> tuple[str, ...]:
        calls.append(visible_cases)
        return tuple(item["id"] for item in visible_cases)

    visible_ids = asyncio.run(
        run_refinement_with_diagnosis_cases(CASES, manifest, refinement)
    )

    assert len(calls) == 1
    assert visible_ids == manifest.diagnosis_ids
    call_dump = str(calls)
    assert "refund one" not in call_dump
    for reserved_id in manifest.reserved_ids:
        assert reserved_id not in call_dump
        reserved_case = next(item for item in CASES if item.id == reserved_id)
        assert reserved_case.content not in call_dump
        assert reserved_case.session_id not in call_dump
        assert reserved_case.similarity_group not in call_dump


def test_partition_seals_manifest_and_blocks_reserved_learning_sources() -> None:
    manifest = seal_partition_manifest(
        partition_cases(
            CASES,
            PartitionOptions(seed="round-17", minimum_reserved=2, reserved_ratio=0.34),
        )
    )

    assert isinstance(manifest, PartitionManifest)
    assert type(manifest.diagnosis_ids) is tuple
    assert type(manifest.reserved_ids) is tuple
    assert_learning_sources(manifest, (manifest.diagnosis_ids[0],))
    with pytest.raises(ValueError, match="RESERVED_CASE_EVIDENCE_FORBIDDEN"):
        assert_learning_sources(manifest, (manifest.reserved_ids[0],))


@pytest.mark.parametrize(
    ("cases", "options", "error"),
    [
        pytest.param(
            (PartitionCase(id="a", session_id="s", similarity_group="g", content="x"),),
            PartitionOptions(seed="s", minimum_reserved=1, reserved_ratio=0.5),
            "PARTITION_REQUIRES_MULTIPLE_CASES",
            id="requires-multiple",
        ),
        pytest.param(
            (
                PartitionCase(id="a", session_id="s", similarity_group="g", content="x"),
                PartitionCase(id="b", session_id="s2", similarity_group="g2", content="y"),
            ),
            PartitionOptions(seed="s", minimum_reserved=0, reserved_ratio=0.5),
            "RESERVED_SIZE_INVALID",
            id="minimum-reserved-invalid",
        ),
        pytest.param(
            (
                PartitionCase(id="a", session_id="s", similarity_group="g", content="x"),
                PartitionCase(id="b", session_id="s2", similarity_group="g2", content="y"),
            ),
            PartitionOptions(seed="s", minimum_reserved=1, reserved_ratio=1.0),
            "RESERVED_RATIO_INVALID",
            id="ratio-invalid",
        ),
        pytest.param(
            (
                PartitionCase(id="a", session_id="s", similarity_group="g", content="x"),
                PartitionCase(id="a", session_id="s2", similarity_group="g2", content="y"),
            ),
            PartitionOptions(seed="s", minimum_reserved=1, reserved_ratio=0.5),
            "CASE_ID_DUPLICATE",
            id="duplicate-id",
        ),
    ],
)
def test_partition_validates_invalid_inputs(
    cases: tuple[PartitionCase, ...],
    options: PartitionOptions,
    error: str,
) -> None:
    with pytest.raises(ValueError, match=error):
        partition_cases(cases, options)


def test_partition_rejects_unsatisfiable_reserved_minimum() -> None:
    cases = (
        PartitionCase(id="x1", session_id="same", similarity_group="all", content="x1"),
        PartitionCase(id="x2", session_id="same", similarity_group="all", content="x2"),
        PartitionCase(id="x3", session_id="same", similarity_group="all", content="x3"),
    )
    with pytest.raises(ValueError, match="RESERVED_SIZE_UNSATISFIABLE"):
        partition_cases(
            cases,
            PartitionOptions(seed="seed", minimum_reserved=1, reserved_ratio=0.34),
        )