from __future__ import annotations

from dataclasses import dataclass

from ....infrastructure.json_values import JsonObject, require_integer, require_number
from ....model.constants import (
    MAXIMUM_BATCH_SIZE,
    MAXIMUM_LEARNING_RATE,
    MAXIMUM_TRAINING_STEPS,
)
from ....model.contracts import TrainingProgress, TrainingResult
from ..common import parse_seed


@dataclass(frozen=True, slots=True)
class TrainingInput:
    steps: int
    batch_size: int
    learning_rate: float
    seed: int


def parse_training_input(value: JsonObject) -> TrainingInput:
    return TrainingInput(
        steps=require_integer(
            value.get("steps"),
            "request.input.steps",
            minimum=1,
            maximum=MAXIMUM_TRAINING_STEPS,
        ),
        batch_size=require_integer(
            value.get("batchSize"),
            "request.input.batchSize",
            minimum=1,
            maximum=MAXIMUM_BATCH_SIZE,
        ),
        learning_rate=require_number(
            value.get("learningRate"),
            "request.input.learningRate",
            minimum_exclusive=0,
            maximum=MAXIMUM_LEARNING_RATE,
        ),
        seed=parse_seed(value.get("seed"), "request.input.seed"),
    )


def create_training_progress(progress: TrainingProgress) -> JsonObject:
    return {
        "step": progress.step,
        "totalSteps": progress.total_steps,
        "loss": progress.loss,
    }


def create_training_result_data(result: TrainingResult) -> JsonObject:
    return {
        "steps": result.steps,
        "initialLoss": result.initial_loss,
        "finalLoss": result.final_loss,
    }
