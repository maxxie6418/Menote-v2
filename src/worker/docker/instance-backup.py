"""Create, check and unpack a deployment snapshot of a D1 dump and R2 objects."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile, ZipInfo


FORMAT = "menote-instance"
VERSION = 1
DATABASE = "database.sql"
MANIFEST = "manifest.json"
COMPLETE = "COMPLETE"
OBJECTS = "objects"
CHUNK = 1024 * 1024
MAX_MANIFEST = 64 * CHUNK
RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"{group}{index}" for group in ("COM", "LPT") for index in range(1, 10)}


def entry_name(name):
    path = PurePosixPath(name)
    if (
        not path.parts or path.is_absolute() or path.as_posix() != name
        or any(part in (".", "..") or part.endswith((" ", ".")) for part in path.parts)
        or any(char in name for char in '\\:*?"<>|')
        or any(ord(char) < 32 for char in name)
        or any(part.split(".", 1)[0].upper() in RESERVED for part in path.parts)
    ):
        raise ValueError(f"Unsafe archive path: {name!r}")
    return path


def no_duplicate_paths(names):
    folders = {}
    files = set()
    directories = set()
    for name in names:
        path = entry_name(name)
        folded = name.casefold()
        if folded in files:
            raise ValueError(f"Duplicate archive path: {name!r}")
        files.add(folded)
        for parent in path.parents:
            actual = parent.as_posix()
            folded_parent = actual.casefold()
            if folders.setdefault(folded_parent, actual) != actual:
                raise ValueError(f"Conflicting directory names: {actual!r}")
            directories.add(folded_parent)
    if files & directories:
        raise ValueError("An archive entry is both a file and a directory")


def digest_copy(source, target=None, expected_size=None):
    hasher = hashlib.sha256()
    size = 0
    while chunk := source.read(CHUNK):
        size += len(chunk)
        if expected_size is not None and size > expected_size:
            raise ValueError("Archive entry exceeds the expected size")
        hasher.update(chunk)
        if target is not None:
            target.write(chunk)
    return size, hasher.hexdigest()


def stream_entry(archive, name, path):
    info = ZipInfo(name)
    info.compress_type = ZIP_DEFLATED if name == DATABASE else ZIP_STORED
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
        return digest_copy(source, target)


def pack(sql_file, object_dir, output):
    if sql_file.is_symlink() or not sql_file.is_file() or sql_file.stat().st_size == 0:
        raise ValueError("A non-empty D1 SQL dump is required")
    if object_dir.is_symlink() or not object_dir.is_dir():
        raise ValueError("An R2 object staging directory is required")
    if output.resolve().is_relative_to(object_dir.resolve()):
        raise ValueError("Write the ZIP outside the R2 object staging directory")

    sources = [(DATABASE, sql_file)]
    for path in sorted(object_dir.rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError(f"Unsupported object staging entry: {path.name!r}")
        if path.is_file():
            sources.append((f"{OBJECTS}/{path.relative_to(object_dir).as_posix()}", path))
    no_duplicate_paths(name for name, _ in sources)

    with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".menote-backup-", suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        try:
            with ZipFile(handle, "w", allowZip64=True) as archive:
                files = {}
                for name, path in sources:
                    size, digest = stream_entry(archive, name, path)
                    files[name] = {"bytes": size, "sha256": digest}
                manifest = json.dumps({"format": FORMAT, "version": VERSION, "files": files},
                                      ensure_ascii=False, sort_keys=True).encode("utf-8")
                if len(manifest) > MAX_MANIFEST:
                    raise ValueError("Backup manifest is too large")
                archive.writestr(MANIFEST, manifest)
                archive.writestr(COMPLETE, hashlib.sha256(manifest).hexdigest())
        except BaseException:
            handle.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        verify(temporary)
        # A hard link publishes the verified archive atomically without overwriting
        # an existing backup. The temporary file lives on the same filesystem.
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return len(sources) - 1


def check_manifest(archive):
    entries = archive.infolist()
    no_duplicate_paths(entry.filename for entry in entries)
    info = {entry.filename: entry for entry in entries}
    if MANIFEST not in info or COMPLETE not in info:
        raise ValueError("ZIP is missing its manifest or completion marker")
    if info[MANIFEST].file_size > MAX_MANIFEST or info[COMPLETE].file_size != 64:
        raise ValueError("Invalid backup metadata size")
    manifest_bytes = archive.read(MANIFEST)
    if hashlib.sha256(manifest_bytes).hexdigest().encode() != archive.read(COMPLETE):
        raise ValueError("Backup manifest checksum mismatch")
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("version") != VERSION:
        raise ValueError("Unsupported Menote backup format")
    files = manifest.get("files")
    if not isinstance(files, dict) or DATABASE not in files or set(info) != set(files) | {MANIFEST, COMPLETE}:
        raise ValueError("Archive entries do not match the backup manifest")
    for name, metadata in files.items():
        if name != DATABASE and not name.startswith(f"{OBJECTS}/"):
            raise ValueError(f"Unrecognized backup entry: {name!r}")
        if not isinstance(metadata, dict) or type(metadata.get("bytes")) is not int:
            raise ValueError(f"Invalid size for {name!r}")
        if metadata["bytes"] != info[name].file_size or (name == DATABASE and metadata["bytes"] == 0):
            raise ValueError(f"Entry size mismatch: {name!r}")
        if info[name].is_dir() or stat.S_ISLNK(info[name].external_attr >> 16):
            raise ValueError(f"Unsupported archive entry: {name!r}")
    return files


def verify_or_extract(archive_file, target=None):
    with ZipFile(archive_file) as archive:
        files = check_manifest(archive)
        if target is not None:
            (target / OBJECTS).mkdir(mode=0o700)
        for name, metadata in files.items():
            with archive.open(name) as source:
                if target is None:
                    size, digest = digest_copy(source, expected_size=metadata["bytes"])
                else:
                    path = target.joinpath(*entry_name(name).parts)
                    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with path.open("xb") as output:
                        size, digest = digest_copy(source, output, metadata["bytes"])
            if size != metadata["bytes"] or digest != metadata.get("sha256"):
                raise ValueError(f"Entry checksum mismatch: {name!r}")
    return len(files) - 1


def verify(archive_file):
    return verify_or_extract(archive_file)


def unpack(archive_file, destination):
    if destination.exists() or destination.is_symlink():
        raise ValueError("Restore staging destination must be new")
    with tempfile.TemporaryDirectory(dir=destination.parent, prefix=".menote-restore-") as temporary:
        staging = Path(temporary) / "snapshot"
        staging.mkdir(mode=0o700)
        count = verify_or_extract(archive_file, staging)
        if destination.exists() or destination.is_symlink():
            raise ValueError("Restore staging destination already exists")
        staging.rename(destination)
        return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    operations = parser.add_subparsers(dest="action", required=True)
    create = operations.add_parser("pack", help="package a D1 SQL dump and a complete R2 object mirror")
    create.add_argument("--sql", required=True, type=Path)
    create.add_argument("--objects", required=True, type=Path)
    create.add_argument("--output", required=True, type=Path)
    check = operations.add_parser("verify", help="check the manifest, object sizes and SHA-256 hashes")
    check.add_argument("archive", type=Path)
    extract = operations.add_parser("unpack", help="verify and restore files into a new staging directory")
    extract.add_argument("archive", type=Path)
    extract.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "pack":
            count = pack(args.sql, args.objects, args.output)
        elif args.action == "verify":
            count = verify(args.archive)
        else:
            count = unpack(args.archive, args.destination)
    except (OSError, ValueError, BadZipFile, RuntimeError) as error:
        print(f"Menote backup error: {error}", file=sys.stderr)
        return 1
    print(f"{args.action}: database.sql and {count} R2 object(s) verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
