from __future__ import annotations

from . import DomainModel


class EvaluatorDefinition(DomainModel):
    id: str
    version: str
    minimum_sample_size: int
    recommendation_threshold: float
    maximum_regression_rate: float
