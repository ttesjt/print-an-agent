from __future__ import annotations

from dataclasses import dataclass

from ....infrastructure.json_values import JsonObject, require_string
from ....model.contracts import ExportedModel
from ...constants import OUTPUT_FORMAT


@dataclass(frozen=True, slots=True)
class ExportInput:
    format: str


def parse_export_input(value: JsonObject) -> ExportInput:
    requested_format = require_string(value.get("format"), "request.input.format")
    if requested_format != OUTPUT_FORMAT:
        raise ValueError(f'request.input.format must equal "{OUTPUT_FORMAT}"')
    return ExportInput(format=requested_format)


def create_export_result_data(exported: ExportedModel, request: ExportInput) -> JsonObject:
    return {
        "format": request.format,
        "parameterCount": exported.parameter_count,
    }
