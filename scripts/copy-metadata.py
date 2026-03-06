#!/usr/bin/env python3
"""
Copy file metadata (timestamps) from C: drive source to WSL2 target.
Only updates files that are identical (same size) to preserve WSL-modified files.
"""

import os
import sys
import hashlib
import time
from pathlib import Path
from datetime import datetime

SOURCE = Path("/mnt/c/Users/User/Documents/claude code experiments/Geometry Wars")
TARGET = Path("/home/antoine/claude code experiments/Geometry Wars")

SKIP_DIRS = {
    "node_modules",
    ".git",
}

# Paths relative to target root to skip entirely
SKIP_RELATIVE_PREFIXES = [
    ".claude/worktrees",
    "dist",
]


def should_skip_dir(rel_path: str, dir_name: str) -> bool:
    if dir_name in SKIP_DIRS:
        return True
    for prefix in SKIP_RELATIVE_PREFIXES:
        if rel_path == prefix or rel_path.startswith(prefix + "/"):
            return True
    return False


def quick_hash(path: Path, chunk_size: int = 65536) -> str:
    """SHA256 of first 64KB + file size — fast approximate comparison."""
    h = hashlib.sha256()
    size = path.stat().st_size
    h.update(str(size).encode())
    try:
        with open(path, "rb") as f:
            data = f.read(chunk_size)
            h.update(data)
    except (PermissionError, OSError):
        return ""
    return h.hexdigest()


def format_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def run(dry_run: bool = False, test_subdir: str = None, verbose: bool = False):
    updated = []
    skipped_modified = []
    skipped_not_found = []
    skipped_errors = []
    total = 0

    if test_subdir:
        target_root = TARGET / test_subdir
        source_root = SOURCE / test_subdir
    else:
        target_root = TARGET
        source_root = SOURCE

    for dirpath, dirnames, filenames in os.walk(target_root):
        # Compute relative path from target root
        rel_dir = os.path.relpath(dirpath, TARGET)

        # Filter out skip dirs in-place (modifies dirnames to prevent descent)
        dirnames[:] = [
            d for d in dirnames
            if not should_skip_dir(
                os.path.join(rel_dir, d).lstrip("./"),
                d
            )
        ]

        for filename in filenames:
            target_file = Path(dirpath) / filename
            rel_path = os.path.relpath(str(target_file), str(TARGET))
            source_file = SOURCE / rel_path
            total += 1

            # Skip symlinks
            if target_file.is_symlink():
                if verbose:
                    print(f"SKIP (symlink): {rel_path}")
                continue

            # Check if source exists
            if not source_file.exists() or source_file.is_symlink():
                skipped_not_found.append(rel_path)
                if verbose:
                    print(f"SKIP (not in source): {rel_path}")
                continue

            try:
                target_stat = target_file.stat()
                source_stat = source_file.stat()
            except (PermissionError, OSError) as e:
                skipped_errors.append((rel_path, str(e)))
                continue

            # Check if file sizes differ → assume modified
            if target_stat.st_size != source_stat.st_size:
                skipped_modified.append(rel_path)
                if verbose:
                    print(f"SKIP (size differs {target_stat.st_size} vs {source_stat.st_size}): {rel_path}")
                continue

            # Sizes match — copy timestamps
            src_mtime = source_stat.st_mtime
            src_atime = source_stat.st_atime
            tgt_mtime = target_stat.st_mtime

            # Don't update if already identical timestamps
            if abs(tgt_mtime - src_mtime) < 2.0:
                if verbose:
                    print(f"SKIP (already same ts): {rel_path}")
                continue

            if not dry_run:
                try:
                    os.utime(str(target_file), (src_atime, src_mtime))
                    updated.append((rel_path, src_mtime))
                    if verbose:
                        print(f"UPDATED: {rel_path} → {format_ts(src_mtime)}")
                except (PermissionError, OSError) as e:
                    skipped_errors.append((rel_path, str(e)))
            else:
                updated.append((rel_path, src_mtime))
                if verbose:
                    print(f"[DRY RUN] WOULD UPDATE: {rel_path} → {format_ts(src_mtime)}")

    # Sort updated by mtime descending for top 20
    updated_sorted = sorted(updated, key=lambda x: x[1], reverse=True)

    print("\n" + "=" * 60)
    print("METADATA COPY REPORT")
    if test_subdir:
        print(f"Scope: {test_subdir}")
    if dry_run:
        print("MODE: DRY RUN (no changes made)")
    print("=" * 60)
    print(f"Total files scanned:     {total}")
    print(f"Files updated:           {len(updated)}")
    print(f"Skipped (modified):      {len(skipped_modified)}")
    print(f"Skipped (not in source): {len(skipped_not_found)}")
    print(f"Errors:                  {len(skipped_errors)}")

    if updated_sorted:
        print(f"\nTop 20 most recently modified files (after restore):")
        for rel_path, mtime in updated_sorted[:20]:
            print(f"  {format_ts(mtime)}  {rel_path}")

    if skipped_errors:
        print(f"\nErrors ({len(skipped_errors)}):")
        for path, err in skipped_errors[:10]:
            print(f"  {path}: {err}")

    if skipped_modified and verbose:
        print(f"\nSkipped (modified) — first 20:")
        for p in skipped_modified[:20]:
            print(f"  {p}")

    print("=" * 60)
    return len(updated), len(skipped_modified), len(skipped_not_found)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Copy file timestamps from C: drive to WSL2")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without modifying anything")
    parser.add_argument("--test", metavar="SUBDIR", help="Run on a subdirectory only (e.g. src/entities)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print every file decision")
    args = parser.parse_args()

    run(dry_run=args.dry_run, test_subdir=args.test, verbose=args.verbose)
