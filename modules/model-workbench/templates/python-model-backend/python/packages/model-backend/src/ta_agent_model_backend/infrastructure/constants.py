from enum import StrEnum

MAXIMUM_REQUEST_BYTES = 4 * 1_048_576
MAXIMUM_PROTOCOL_MESSAGE_BYTES = 1_048_576
ARTIFACT_READ_CHUNK_BYTES = 1_048_576
MAXIMUM_FAILURE_MESSAGE_CHARACTERS = 2_000

ARTIFACT_ROOT_ENVIRONMENT_VARIABLE = "TA_AGENT_MODEL_BACKEND_ROOT_DIRECTORY"
ARTIFACT_DIRECTORY_NAME = "artifacts"
ARTIFACT_RECEIPT_KIND = "local-directory"


class BackendCommand(StrEnum):
    INITIALIZE = "initialize"
    TRAIN = "train"
    EXPORT = "export"
    INVOKE = "invoke"


class ModelOperation(StrEnum):
    INITIALIZATION = "initialization"
    TRAINING = "training"
    EXPORT = "export"


class OperationMessageKind(StrEnum):
    PROGRESS = "progress"
    TERMINAL = "terminal"


class InvocationMessageKind(StrEnum):
    COMPLETED = "completed"
    STREAM_START = "stream-start"
    CHUNK = "chunk"


class ExecutionStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
