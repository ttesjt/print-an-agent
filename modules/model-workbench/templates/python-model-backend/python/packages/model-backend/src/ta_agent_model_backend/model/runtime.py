from __future__ import annotations

import torch

from .constants import SUPPORTED_DEVICE_TYPES, SUPPORTED_DTYPES
from .contracts import TorchRuntime

_TORCH_DTYPES = {
    "float16": torch.float16,
    "float32": torch.float32,
    "bfloat16": torch.bfloat16,
}


def resolve_torch_runtime(device: str, dtype: str) -> TorchRuntime:
    resolved_device = torch.device(device)
    if resolved_device.type not in SUPPORTED_DEVICE_TYPES:
        supported = ", ".join(sorted(SUPPORTED_DEVICE_TYPES))
        raise ValueError(f"device type must be one of: {supported}")
    if resolved_device.type == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA was selected but is not available")
    if resolved_device.type == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS was selected but is not available")
    if dtype not in SUPPORTED_DTYPES:
        supported = ", ".join(sorted(SUPPORTED_DTYPES))
        raise ValueError(f"dtype must be one of: {supported}")
    return TorchRuntime(device=str(resolved_device), dtype=dtype)


def torch_device(runtime: TorchRuntime) -> torch.device:
    return torch.device(runtime.device)


def torch_dtype(runtime: TorchRuntime) -> torch.dtype:
    return _TORCH_DTYPES[runtime.dtype]
