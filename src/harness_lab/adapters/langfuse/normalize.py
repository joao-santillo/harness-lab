from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from harness_lab.domain.models import DomainModel


class _RawObservation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    trace_id: str = Field(alias="traceId")
    parent_observation_id: str | None = Field(default=None, alias="parentObservationId")
    type: str
    input: Any = None
    output: Any = None
    start_time: str = Field(alias="startTime")
    end_time: str | None = Field(default=None, alias="endTime")
    usage_details: dict[str, float] | None = Field(default=None, alias="usageDetails")
    cost_details: dict[str, float] | None = Field(default=None, alias="costDetails")


class NormalizedObservation(DomainModel):
    project_id: str
    id: str
    trace_id: str
    parent_id: str | None
    type: str
    input: Any
    output: Any
    start_time: str
    end_time: str | None
    latency_ms: int | None
    usage: dict[str, float] | None
    cost: dict[str, float] | None
    source_api: str


class NormalizedObservationsResult(DomainModel):
    observations: tuple[NormalizedObservation, ...]
    logical_root_ids: tuple[str, ...]
    limitations: tuple[str, ...]


_observations_adapter = TypeAdapter(list[_RawObservation])


def _to_millis(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def normalize_observations(project_id: str, input_items: tuple[object, ...] | list[object]) -> NormalizedObservationsResult:
    unique: dict[str, _RawObservation] = {}
    for observation in _observations_adapter.validate_python(list(input_items)):
        unique[f"{project_id}:{observation.id}"] = observation

    values = list(unique.values())
    ids = {observation.id for observation in values}
    limitations: list[str] = []
    roots: list[str] = []
    observations: list[NormalizedObservation] = []

    for observation in values:
        parent_id = observation.parent_observation_id
        if parent_id is None or parent_id not in ids:
            roots.append(observation.id)
        if parent_id is not None and parent_id not in ids:
            limitations.append(
                f"Observation {observation.id} references missing parent {parent_id}."
            )
        if observation.usage_details is None or observation.cost_details is None:
            limitations.append(f"Observation {observation.id} has missing usage or cost metrics.")

        latency_ms = None
        if observation.end_time is not None:
            latency_ms = _to_millis(observation.end_time) - _to_millis(observation.start_time)

        observations.append(
            NormalizedObservation(
                project_id=project_id,
                id=observation.id,
                trace_id=observation.trace_id,
                parent_id=parent_id,
                type=observation.type,
                input=observation.input,
                output=observation.output,
                start_time=observation.start_time,
                end_time=observation.end_time,
                latency_ms=latency_ms,
                usage=observation.usage_details,
                cost=observation.cost_details,
                source_api="observations-v2",
            )
        )

    roots_by_trace: dict[str, int] = {}
    root_ids = set(roots)
    for observation in observations:
        if observation.id in root_ids:
            roots_by_trace[observation.trace_id] = roots_by_trace.get(observation.trace_id, 0) + 1

    for trace_id, count in roots_by_trace.items():
        if count > 1:
            limitations.append(f"Trace {trace_id} has multiple logical roots.")

    return NormalizedObservationsResult(
        observations=tuple(observations),
        logical_root_ids=tuple(roots),
        limitations=tuple(limitations),
    )
