import hashlib
import json
import os
import pathlib
import sys
import time
import unicodedata


def artifact_digest(directory: pathlib.Path) -> str:
    entries: list[tuple[str, pathlib.Path]] = []
    for root, directories, files in os.walk(directory):
        directories.sort()
        for filename in files:
            path = pathlib.Path(root) / filename
            relative = unicodedata.normalize("NFC", path.relative_to(directory).as_posix())
            entries.append((relative, path))
    entries.sort(key=lambda entry: entry[0].encode("utf-8"))
    digest = hashlib.sha256()
    for relative, path in entries:
        name = relative.encode("utf-8")
        size = path.stat().st_size
        digest.update(b"file\0")
        digest.update(str(len(name)).encode("ascii"))
        digest.update(b"\0")
        digest.update(name)
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\0")
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def create_artifact(configuration: dict) -> dict:
    directory = pathlib.Path(configuration["directory"])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "model.json").write_text(
        json.dumps(configuration["content"], sort_keys=True) + "\n", encoding="utf-8"
    )
    return {
        "digest": artifact_digest(directory),
        "receipt": {
            "kind": "local-directory",
            "relativePath": configuration["relativePath"],
        },
    }


def run_operation(request: dict) -> None:
    configuration = request["input"]
    print(json.dumps({"kind": "progress", "progress": {"phase": "working"}}), flush=True)
    time.sleep(configuration.get("delaySeconds", 0))
    artifact = create_artifact(configuration["artifact"])
    operation = request["operation"]
    if operation == "initialization":
        result = {"artifact": artifact, "data": {"backend": "tiny-python"}}
    elif operation == "training":
        result = {
            "assetKind": configuration["assetKind"],
            "artifact": artifact,
            "data": {"steps": configuration.get("steps", 1)},
        }
    elif operation == "export":
        result = {
            "artifacts": [{"name": "model", "artifact": artifact}],
            "data": {"format": "tiny-json"},
        }
    else:
        raise ValueError(f"unsupported operation: {operation}")
    print(
        json.dumps(
            {"kind": "terminal", "terminal": {"status": "succeeded", "result": result}}
        ),
        flush=True,
    )


def invoke_output(request: dict) -> None:
    artifact = request["target"]["artifacts"][0]["artifact"]
    model = json.loads(
        (pathlib.Path(artifact["binding"]["directory"]) / "model.json").read_text("utf-8")
    )
    prompt = request["input"]["prompt"]
    if request["input"].get("stream", False):
        print(json.dumps({"kind": "stream-start"}), flush=True)
        print(json.dumps({"kind": "chunk", "result": {"text": prompt}}), flush=True)
        print(json.dumps({"kind": "chunk", "result": {"model": model}}), flush=True)
    else:
        print(
            json.dumps({"kind": "completed", "result": {"text": prompt, "model": model}}),
            flush=True,
        )


request_document = json.load(sys.stdin)
if "operation" in request_document:
    run_operation(request_document)
else:
    invoke_output(request_document)
