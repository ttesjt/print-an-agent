from __future__ import annotations

import hashlib
import shutil
import stat
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from tempfile import mkdtemp

from .constants import ARTIFACT_READ_CHUNK_BYTES, ARTIFACT_RECEIPT_KIND
from .errors import BackendError, BackendErrorCode
from .json_values import JsonObject

ArtifactWriter = Callable[[Path], None]


@dataclass(frozen=True, slots=True)
class PublishedArtifact:
    digest: str
    receipt: JsonObject

    def to_json(self) -> JsonObject:
        return {"digest": self.digest, "receipt": self.receipt}


class LocalArtifactPublisher:
    def __init__(self, artifact_root: Path) -> None:
        self._artifact_root = artifact_root.resolve()
        self._artifact_root.mkdir(parents=True, exist_ok=True)

    def publish(self, relative_path: str, writer: ArtifactWriter) -> PublishedArtifact:
        canonical_relative_path = _parse_relative_path(relative_path)
        destination = self._artifact_root.joinpath(*canonical_relative_path.parts)
        _assert_contained_path(self._artifact_root, destination)
        staging_root = self._artifact_root / ".staging"
        staging_root.mkdir(parents=True, exist_ok=True)
        staging = Path(mkdtemp(prefix="artifact-", dir=staging_root))
        try:
            writer(staging)
            staged_digest = derive_directory_digest(staging)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.is_symlink():
                raise BackendError(
                    BackendErrorCode.ARTIFACT_FAILURE,
                    f"Artifact destination cannot be a symbolic link: {relative_path}",
                )
            if destination.exists():
                if derive_directory_digest(destination) != staged_digest:
                    raise BackendError(
                        BackendErrorCode.ARTIFACT_FAILURE,
                        f"Artifact destination already contains different content: {relative_path}",
                    )
            else:
                staging.rename(destination)
            return PublishedArtifact(
                digest=staged_digest,
                receipt={
                    "kind": ARTIFACT_RECEIPT_KIND,
                    "relativePath": canonical_relative_path.as_posix(),
                },
            )
        finally:
            if staging.exists():
                shutil.rmtree(staging)


def derive_directory_digest(directory: Path) -> str:
    root = directory.resolve(strict=True)
    entries: list[tuple[bytes, str, Path]] = []
    normalized_paths: set[str] = set()
    for candidate in root.rglob("*"):
        metadata = candidate.lstat()
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise BackendError(
                BackendErrorCode.ARTIFACT_FAILURE,
                f"Artifact contains a non-regular file: {candidate}",
            )
        relative = unicodedata.normalize("NFC", candidate.relative_to(root).as_posix())
        if relative in normalized_paths:
            raise BackendError(
                BackendErrorCode.ARTIFACT_FAILURE,
                f"Artifact paths collide after Unicode normalization: {relative}",
            )
        normalized_paths.add(relative)
        entries.append((relative.encode("utf-8"), relative, candidate))
    if not entries:
        raise BackendError(BackendErrorCode.ARTIFACT_FAILURE, "Artifact directory is empty.")

    digest = hashlib.sha256()
    for encoded_name, _relative, candidate in sorted(entries, key=lambda item: item[0]):
        before = candidate.stat()
        digest.update(b"file\0")
        digest.update(str(len(encoded_name)).encode("ascii"))
        digest.update(b"\0")
        digest.update(encoded_name)
        digest.update(b"\0")
        digest.update(str(before.st_size).encode("ascii"))
        digest.update(b"\0")
        with candidate.open("rb") as source:
            while chunk := source.read(ARTIFACT_READ_CHUNK_BYTES):
                digest.update(chunk)
        after = candidate.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise BackendError(
                BackendErrorCode.ARTIFACT_FAILURE,
                f"Artifact changed while hashing: {candidate}",
            )
    return f"sha256:{digest.hexdigest()}"


def _parse_relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise BackendError(
            BackendErrorCode.ARTIFACT_FAILURE,
            "Artifact relative path must be a contained POSIX path.",
        )
    if "\\" in value:
        raise BackendError(
            BackendErrorCode.ARTIFACT_FAILURE,
            "Artifact relative path must use POSIX separators.",
        )
    return path


def _assert_contained_path(root: Path, candidate: Path) -> None:
    try:
        candidate.resolve(strict=False).relative_to(root)
    except ValueError as error:
        raise BackendError(
            BackendErrorCode.ARTIFACT_FAILURE,
            "Artifact destination escapes the configured root.",
        ) from error
