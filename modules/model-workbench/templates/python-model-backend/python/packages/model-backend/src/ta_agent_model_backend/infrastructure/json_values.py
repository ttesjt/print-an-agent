from __future__ import annotations

from typing import TypeAlias

JsonScalar: TypeAlias = None | bool | int | float | str
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


def require_object(value: JsonValue, path: str) -> JsonObject:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return value


def require_string(value: JsonValue | None, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{path} must be a non-empty string")
    return value


def require_integer(
    value: JsonValue | None,
    path: str,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{path} must be an integer")
    if minimum is not None and value < minimum:
        raise ValueError(f"{path} must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{path} must be at most {maximum}")
    return value


def require_boolean(value: JsonValue | None, path: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{path} must be a boolean")
    return value


def require_number(
    value: JsonValue | None,
    path: str,
    *,
    minimum_exclusive: float | None = None,
    maximum: float | None = None,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{path} must be a number")
    result = float(value)
    if minimum_exclusive is not None and result <= minimum_exclusive:
        raise ValueError(f"{path} must be greater than {minimum_exclusive}")
    if maximum is not None and result > maximum:
        raise ValueError(f"{path} must be at most {maximum}")
    return result
