"""Fail closed on the size of the complete, staged Pages root.

Run after staging the generated publication. Git's index includes the archived
source data and every other tracked path, but excludes untracked build output,
dependencies, ignored files, and .git itself. No working-tree file is followed.
"""
import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import re
import subprocess
import sys

PAGES_ROOT_MAX_BYTES = 950_000_000
OBJECT_ID = re.compile(rb"(?:[a-f0-9]{40}|[a-f0-9]{64})")


@dataclass(frozen=True)
class IndexEntry:
    path: bytes
    object_id: bytes


@dataclass(frozen=True)
class TreeSize:
    files: int
    bytes: int


def parse_index(data):
    if not data or not data.endswith(b"\0"):
        raise ValueError("Git index is empty or incomplete")
    entries, paths = [], set()
    for item in data[:-1].split(b"\0"):
        metadata, separator, path = item.partition(b"\t")
        fields = metadata.split(b" ")
        if not separator or len(fields) != 3:
            raise ValueError("Malformed Git index entry")
        mode, object_id, stage = fields
        if stage != b"0":
            raise ValueError("Unmerged Git index entry; publication size is not confirmed")
        if mode not in (b"100644", b"100755"):
            raise ValueError("Pages tree contains a symlink, submodule, or unsupported file mode")
        if not OBJECT_ID.fullmatch(object_id):
            raise ValueError("Invalid Git object ID")
        parts = path.split(b"/")
        if (
            not path
            or b"\\" in path
            or any(part in (b"", b".", b"..") or part.lower() == b".git" for part in parts)
            or path in paths
        ):
            raise ValueError("Unsafe or duplicate Git index path")
        paths.add(path)
        entries.append(IndexEntry(path, object_id))
    return entries


def parse_blob_sizes(data, object_ids):
    lines = data.splitlines()
    if len(lines) != len(object_ids):
        raise ValueError("Git object size response is incomplete")
    sizes = {}
    for expected, line in zip(object_ids, lines):
        fields = line.split(b" ")
        if (
            len(fields) != 3
            or fields[0] != expected
            or fields[1] != b"blob"
            or not re.fullmatch(rb"[0-9]+", fields[2])
        ):
            raise ValueError("Git object is missing, not a blob, or has an unknown size")
        sizes[expected] = int(fields[2])
    return sizes


def git_output(root, arguments, data=None):
    return subprocess.check_output(
        ["git", "-C", str(root), *arguments],
        input=data,
        stderr=subprocess.PIPE,
        timeout=60,
    )


def measure_pages_tree(root):
    # Verify a repository is present; do not infer a zero-byte tree on failure.
    top = git_output(root, ["rev-parse", "--show-toplevel"])
    if not top.endswith(b"\n") or not top[:-1]:
        raise ValueError("Git repository root is unknown")
    # ls-files otherwise scopes its output to a supplied repository subdirectory.
    root = Path(os.fsdecode(top[:-1]))
    entries = parse_index(git_output(root, ["ls-files", "--stage", "--full-name", "-z"]))
    object_ids = list(dict.fromkeys(entry.object_id for entry in entries))
    sizes = parse_blob_sizes(
        git_output(
            root,
            ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
            b"\n".join(object_ids) + b"\n",
        ),
        object_ids,
    )
    # Git deduplicates blobs, but Pages publishes every path separately.
    return TreeSize(len(entries), sum(sizes[entry.object_id] for entry in entries))


def check_pages_tree(root, limit=PAGES_ROOT_MAX_BYTES):
    if type(limit) is not int or limit < 0:
        raise ValueError("Pages root limit must be a nonnegative integer")
    size = measure_pages_tree(root)
    if size.bytes > limit:
        raise ValueError(
            f"Complete staged Pages root is {size.bytes} bytes across {size.files} files, "
            f"exceeding the {limit}-byte limit. This includes tracked source archives; "
            "the 800 MB research-monitor subtree check does not replace this limit. "
            "No commit or push may proceed."
        )
    return size


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--max-bytes", type=int, default=PAGES_ROOT_MAX_BYTES)
    arguments = parser.parse_args(argv)
    try:
        size = check_pages_tree(arguments.repo_root, arguments.max_bytes)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        if isinstance(error, ValueError):
            message = str(error)
        else:
            message = f"Could not verify complete staged Pages root ({type(error).__name__})"
        print(f"::error::{message}", file=sys.stderr)
        return 1
    print(
        f"Complete staged Pages root: {size.bytes} bytes across {size.files} tracked files "
        f"(limit {arguments.max_bytes} bytes)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
