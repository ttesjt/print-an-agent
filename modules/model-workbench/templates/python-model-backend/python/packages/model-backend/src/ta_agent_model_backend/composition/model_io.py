from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import cast

import torch
from torch import Tensor

from ..infrastructure.json_values import (
    JsonObject,
    JsonValue,
    require_integer,
    require_object,
    require_string,
)
from ..model.contracts import ExportedModel, ModelCheckpoint, TinyTransformerConfiguration
from .constants import (
    CHECKPOINT_FORMAT,
    CHECKPOINT_METADATA_FILE_NAME,
    MAXIMUM_MODEL_METADATA_BYTES,
    OUTPUT_ARTIFACT_NAME,
    OUTPUT_FORMAT,
    OUTPUT_METADATA_FILE_NAME,
    WEIGHTS_FILE_NAME,
)


def read_source_checkpoint(request: JsonObject) -> ModelCheckpoint:
    source = require_object(request.get("source"), "request.source")
    modifications = source.get("modifications")
    if not isinstance(modifications, list):
        raise ValueError("request.source.modifications must be an array")
    if modifications:
        raise ValueError("this backend does not support Modification inputs")
    base = require_object(source.get("base"), "request.source.base")
    artifact = require_object(base.get("artifact"), "request.source.base.artifact")
    binding = require_object(artifact.get("binding"), "request.source.base.artifact.binding")
    return read_checkpoint(_materialized_directory(binding, "request.source.base.artifact.binding"))


def read_output_model(request: JsonObject) -> ExportedModel:
    target = require_object(request.get("target"), "request.target")
    artifacts = target.get("artifacts")
    if not isinstance(artifacts, list):
        raise ValueError("request.target.artifacts must be an array")
    for index, value in enumerate(artifacts):
        artifact = require_object(value, f"request.target.artifacts[{index}]")
        if artifact.get("name") != OUTPUT_ARTIFACT_NAME:
            continue
        materialized = require_object(
            artifact.get("artifact"), f"request.target.artifacts[{index}].artifact"
        )
        binding_path = f"request.target.artifacts[{index}].artifact.binding"
        binding = require_object(materialized.get("binding"), binding_path)
        return read_export(_materialized_directory(binding, binding_path))
    raise ValueError(f'Output does not contain the "{OUTPUT_ARTIFACT_NAME}" Artifact')


def write_checkpoint(directory: Path, checkpoint: ModelCheckpoint) -> None:
    _write_model_files(
        directory,
        format_name=CHECKPOINT_FORMAT,
        metadata_file_name=CHECKPOINT_METADATA_FILE_NAME,
        configuration=checkpoint.configuration,
        vocabulary=checkpoint.vocabulary,
        state=checkpoint.state,
        parameter_count=checkpoint.parameter_count,
    )


def write_export(directory: Path, model: ExportedModel) -> None:
    _write_model_files(
        directory,
        format_name=OUTPUT_FORMAT,
        metadata_file_name=OUTPUT_METADATA_FILE_NAME,
        configuration=model.configuration,
        vocabulary=model.vocabulary,
        state=model.state,
        parameter_count=model.parameter_count,
    )


def read_checkpoint(directory: Path) -> ModelCheckpoint:
    configuration, vocabulary, state, parameter_count = _read_model_files(
        directory,
        expected_format=CHECKPOINT_FORMAT,
        metadata_file_name=CHECKPOINT_METADATA_FILE_NAME,
    )
    return ModelCheckpoint(
        configuration=configuration,
        vocabulary=vocabulary,
        state=state,
        parameter_count=parameter_count,
    )


def read_export(directory: Path) -> ExportedModel:
    configuration, vocabulary, state, parameter_count = _read_model_files(
        directory,
        expected_format=OUTPUT_FORMAT,
        metadata_file_name=OUTPUT_METADATA_FILE_NAME,
    )
    return ExportedModel(
        configuration=configuration,
        vocabulary=vocabulary,
        state=state,
        parameter_count=parameter_count,
    )


def _write_model_files(
    directory: Path,
    *,
    format_name: str,
    metadata_file_name: str,
    configuration: TinyTransformerConfiguration,
    vocabulary: str,
    state: dict[str, Tensor],
    parameter_count: int,
) -> None:
    _write_json(
        directory / metadata_file_name,
        {
            "format": format_name,
            "configuration": _configuration_to_json(configuration),
            "vocabulary": vocabulary,
            "weights": WEIGHTS_FILE_NAME,
            "parameterCount": parameter_count,
        },
    )
    torch.save(state, directory / WEIGHTS_FILE_NAME)


def _read_model_files(
    directory: Path,
    *,
    expected_format: str,
    metadata_file_name: str,
) -> tuple[TinyTransformerConfiguration, str, dict[str, Tensor], int]:
    payload = _read_json(directory / metadata_file_name)
    if payload.get("format") != expected_format:
        raise ValueError("model Artifact has an unsupported format")
    configuration = _configuration_from_json(
        require_object(payload.get("configuration"), "model.configuration")
    )
    vocabulary = require_string(payload.get("vocabulary"), "model.vocabulary")
    if configuration.vocabulary_size != len(vocabulary):
        raise ValueError("model configuration does not match its vocabulary")
    weights_file_name = require_string(payload.get("weights"), "model.weights")
    if weights_file_name != WEIGHTS_FILE_NAME:
        raise ValueError("model weights file is unsupported")
    parameter_count = require_integer(
        payload.get("parameterCount"), "model.parameterCount", minimum=1
    )
    try:
        loaded = torch.load(
            directory / weights_file_name,
            map_location="cpu",
            weights_only=True,
        )
    except (EOFError, OSError, RuntimeError, ValueError, pickle.UnpicklingError) as error:
        raise ValueError("could not read model weights") from error
    if not isinstance(loaded, dict) or not all(
        isinstance(name, str) and isinstance(value, Tensor) for name, value in loaded.items()
    ):
        raise ValueError("model weights must contain a tensor state dictionary")
    return configuration, vocabulary, cast(dict[str, Tensor], loaded), parameter_count


def _configuration_to_json(configuration: TinyTransformerConfiguration) -> JsonObject:
    return {
        "vocabularySize": configuration.vocabulary_size,
        "contextLength": configuration.context_length,
        "embeddingDimension": configuration.embedding_dimension,
        "attentionHeads": configuration.attention_heads,
        "layers": configuration.layers,
        "feedForwardMultiplier": configuration.feed_forward_multiplier,
    }


def _configuration_from_json(value: JsonObject) -> TinyTransformerConfiguration:
    return TinyTransformerConfiguration(
        vocabulary_size=require_integer(value.get("vocabularySize"), "model.vocabularySize"),
        context_length=require_integer(value.get("contextLength"), "model.contextLength"),
        embedding_dimension=require_integer(
            value.get("embeddingDimension"), "model.embeddingDimension"
        ),
        attention_heads=require_integer(value.get("attentionHeads"), "model.attentionHeads"),
        layers=require_integer(value.get("layers"), "model.layers"),
        feed_forward_multiplier=require_integer(
            value.get("feedForwardMultiplier"), "model.feedForwardMultiplier"
        ),
    )


def _materialized_directory(binding: JsonObject, path: str) -> Path:
    if binding.get("kind") != "local-directory":
        raise ValueError(f"{path}.kind must equal local-directory")
    if binding.get("access") != "read-only":
        raise ValueError(f"{path}.access must equal read-only")
    directory = Path(require_string(binding.get("directory"), f"{path}.directory"))
    if not directory.is_absolute():
        raise ValueError(f"{path}.directory must be absolute")
    return directory


def _write_json(path: Path, value: JsonObject) -> None:
    path.write_text(
        f"{json.dumps(value, allow_nan=False, sort_keys=True, separators=(',', ':'))}\n",
        encoding="utf-8",
    )


def _read_json(path: Path) -> JsonObject:
    try:
        with path.open("rb") as source:
            encoded = source.read(MAXIMUM_MODEL_METADATA_BYTES + 1)
        if len(encoded) > MAXIMUM_MODEL_METADATA_BYTES:
            raise ValueError(f"model metadata exceeds {MAXIMUM_MODEL_METADATA_BYTES} bytes")
        value = json.loads(
            encoded.decode("utf-8"),
            parse_constant=_reject_json_constant,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read model metadata: {path}") from error
    return require_object(cast(JsonValue, value), str(path))


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")
