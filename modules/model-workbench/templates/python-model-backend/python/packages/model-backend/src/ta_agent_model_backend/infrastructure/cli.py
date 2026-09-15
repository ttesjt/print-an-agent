from __future__ import annotations

import sys
from collections.abc import Sequence

from .contracts import BackendHandlers
from .runtime import default_streams, parse_command, run_command


def run_backend_cli(arguments: Sequence[str], handlers: BackendHandlers) -> int:
    try:
        command = parse_command(arguments)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    input_stream, output_stream, error_stream = default_streams()
    return run_command(command, handlers, input_stream, output_stream, error_stream)
