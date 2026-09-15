"""Process entry point. Protocol implementation lives in infrastructure."""

from __future__ import annotations

import sys

from .infrastructure.cli import run_backend_cli


def main() -> int:
    try:
        from .composition.backend import create_backend_handlers
    except ModuleNotFoundError as error:
        if error.name != "torch":
            raise
        print(
            "The real model backend requires the optional 'transformer' dependencies.",
            file=sys.stderr,
        )
        return 2
    return run_backend_cli(sys.argv[1:], create_backend_handlers())
