from __future__ import annotations

import hashlib
import math
from collections.abc import Awaitable, Callable, Iterable
from types import MappingProxyType
from typing import TypeVar

from harness_lab.domain import PartitionCase, PartitionManifest, PartitionOptions

TResult = TypeVar("TResult")


def _stable_rank(seed: str, ids: Iterable[str]) -> str:
    data = f"{seed}\0" + "\0".join(ids)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _grouped_cases(cases: tuple[PartitionCase, ...]) -> tuple[tuple[PartitionCase, ...], ...]:
    remaining = {item.id: item for item in cases}
    groups: list[tuple[PartitionCase, ...]] = []

    while len(remaining) > 0:
        first = next(iter(remaining.values()))
        group = [first]
        del remaining[first.id]

        index = 0
        while index < len(group):
            current = group[index]
            for candidate in tuple(remaining.values()):
                if (
                    candidate.session_id == current.session_id
                    or candidate.similarity_group == current.similarity_group
                ):
                    group.append(candidate)
                    del remaining[candidate.id]
            index += 1

        groups.append(tuple(sorted(group, key=lambda item: item.id)))

    return tuple(groups)


def partition_cases(
    cases: tuple[PartitionCase, ...] | list[PartitionCase],
    options: PartitionOptions,
) -> PartitionManifest:
    normalized_cases = tuple(cases)

    if len(normalized_cases) < 2:
        raise ValueError("PARTITION_REQUIRES_MULTIPLE_CASES")
    if options.minimum_reserved < 1 or options.minimum_reserved >= len(normalized_cases):
        raise ValueError("RESERVED_SIZE_INVALID")
    if options.reserved_ratio <= 0 or options.reserved_ratio >= 1:
        raise ValueError("RESERVED_RATIO_INVALID")
    if len({item.id for item in normalized_cases}) != len(normalized_cases):
        raise ValueError("CASE_ID_DUPLICATE")

    target = max(options.minimum_reserved, math.ceil(len(normalized_cases) * options.reserved_ratio))
    groups = sorted(
        _grouped_cases(normalized_cases),
        key=lambda group: _stable_rank(options.seed, (item.id for item in group)),
    )

    reserved: set[str] = set()
    for group in groups:
        if len(reserved) >= target:
            break
        if len(reserved) + len(group) < len(normalized_cases):
            reserved.update(item.id for item in group)

    if len(reserved) < options.minimum_reserved:
        raise ValueError("RESERVED_SIZE_UNSATISFIABLE")

    all_ids = sorted(item.id for item in normalized_cases)
    return PartitionManifest(
        version=1,
        seed=options.seed,
        diagnosis_ids=tuple(id_ for id_ in all_ids if id_ not in reserved),
        reserved_ids=tuple(id_ for id_ in all_ids if id_ in reserved),
        created_at=options.created_at or "1970-01-01T00:00:00.000Z",
    )


def seal_partition_manifest(manifest: PartitionManifest) -> PartitionManifest:
    return PartitionManifest(
        version=manifest.version,
        seed=manifest.seed,
        diagnosis_ids=tuple(manifest.diagnosis_ids),
        reserved_ids=tuple(manifest.reserved_ids),
        created_at=manifest.created_at,
    )


async def run_refinement_with_diagnosis_cases(
    cases: tuple[PartitionCase, ...] | list[PartitionCase],
    manifest: PartitionManifest,
    refine: Callable[[tuple[dict[str, str], ...]], Awaitable[TResult]],
) -> TResult:
    diagnosis_ids = set(manifest.diagnosis_ids)
    visible_cases = tuple(
        MappingProxyType({"id": item.id, "content": item.content})
        for item in tuple(cases)
        if item.id in diagnosis_ids
    )
    return await refine(visible_cases)


def assert_learning_sources(
    manifest: PartitionManifest,
    source_case_ids: tuple[str, ...] | list[str],
) -> None:
    diagnosis_ids = set(manifest.diagnosis_ids)
    if any(case_id not in diagnosis_ids for case_id in source_case_ids):
        raise ValueError("RESERVED_CASE_EVIDENCE_FORBIDDEN")
