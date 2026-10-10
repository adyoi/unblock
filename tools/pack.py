#!/usr/bin/env python3
"""Package Unblock into a Chrome Web Store ready zip.

Run:  python tools/pack.py

Output: dist/unblock-<version>.zip   (manifest.json at the archive root)
"""

import json
import os
import shutil
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DIST = os.path.join(ROOT, "dist")
STAGE = os.path.join(DIST, ".stage")

# Ship these. Anything not listed here stays out of the package.
INCLUDE_FILES = ["manifest.json", "LICENSE"]
INCLUDE_DIRS = ["css", "icons", "js", "rules", "ui"]

EXCLUDE_DIRS = {"__pycache__", ".git", ".github", "_metadata", "node_modules"}
EXCLUDE_EXT = {".pyc", ".map", ".log", ".tmp", ".bak", ".md"}


def version():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def stage(ver):
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE)

    for name in INCLUDE_FILES:
        src = os.path.join(ROOT, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(STAGE, name))

    for d in INCLUDE_DIRS:
        src = os.path.join(ROOT, d)
        if not os.path.isdir(src):
            continue
        for base, dirs, files in os.walk(src):
            dirs[:] = [x for x in dirs if x not in EXCLUDE_DIRS]
            rel = os.path.relpath(base, ROOT)
            dst = os.path.join(STAGE, rel)
            os.makedirs(dst, exist_ok=True)
            for fn in files:
                if os.path.splitext(fn)[1].lower() in EXCLUDE_EXT:
                    continue
                shutil.copy2(os.path.join(base, fn), os.path.join(dst, fn))

    shutil.copy2(os.path.join(ROOT, "PRIVACY.md"), os.path.join(STAGE, "PRIVACY.md"))
    with open(os.path.join(STAGE, "BUILD.txt"), "w", encoding="utf-8") as f:
        f.write(f"Unblock {ver}\nmanifest_version=3\n")
    return STAGE


def build(stage_dir, ver):
    out_dir = os.path.join(DIST, f"unblock-{ver}.zip")
    if os.path.exists(out_dir):
        os.remove(out_dir)
    count = 0
    with zipfile.ZipFile(out_dir, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, _dirs, files in os.walk(stage_dir):
            for fn in sorted(files):
                full = os.path.join(base, fn)
                z.write(full, os.path.relpath(full, stage_dir).replace(os.sep, "/"))
                count += 1
    return out_dir, count


def main():
    ver = version()
    s = stage(ver)
    out, count = build(s, ver)
    size = os.path.getsize(out)
    shutil.rmtree(STAGE, ignore_errors=True)
    print(f"version : {ver}")
    print(f"files   : {count}")
    print(f"size    : {size / 1024:.1f} KB")
    print(f"output  : {out}")
    print("\nValidate with:")
    print(f"  python tools/verify.py \"{out}\"")


if __name__ == "__main__":
    sys.exit(main())
