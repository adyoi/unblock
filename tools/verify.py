#!/usr/bin/env python3
"""Verify a packed Unblock zip (or the source folder) before publishing.

Run:  python tools/verify.py            # verify the source tree
      python tools/verify.py dist/x.zip # verify a package

Checks:
  * manifest.json parses and targets Manifest V3
  * every file referenced by the manifest exists
  * every rules/*.json referenced resource parses
  * icons exist at every declared size and are square PNGs of that size
  * all JavaScript parses (node --check when available)
  * no leftover legacy branding (ubolite / ubopro / ubp-)
  * no remote script or CDN references in shipped code
"""

import json
import os
import re
import struct
import subprocess
import sys
import zipfile

LEGACY = re.compile(r"ubolite|ubopro|ubp-|\bubp\b", re.I)
REMOTE = re.compile(r"""(?:src|href)\s*=\s*["']https?://""", re.I)
CDN_JS = re.compile(r"""import\s+.*?from\s+["']https?://|fetch\(\s*["']https?://""", re.I)


class Report:
    def __init__(self):
        self.ok = 0
        self.bad = []

    def check(self, cond, msg):
        if cond:
            self.ok += 1
        else:
            self.bad.append(msg)
        return cond


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


def load(src, name):
    if os.path.isdir(src):
        with open(os.path.join(src, name), "rb") as f:
            return f.read()
    with zipfile.ZipFile(src) as z:
        return z.read(name)


def names(src):
    if os.path.isdir(src):
        out = []
        for base, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d not in {".git", "__pycache__", "dist"}]
            for f in files:
                p = os.path.join(base, f)
                out.append((p, os.path.relpath(p, src).replace(os.sep, "/")))
        return out
    with zipfile.ZipFile(src) as z:
        return [(n, n) for n in z.namelist() if not n.endswith("/")]


def read(src, rel):
    return load(src, rel)


def main(src):
    src = os.path.abspath(src)
    r = Report()

    # ---------------------------------------------------------- manifest
    try:
        raw = read(src, "manifest.json")
        mf = json.loads(raw)
    except Exception as e:
        print(f"FATAL: cannot read manifest.json: {e}")
        return 1

    r.check(mf.get("manifest_version") == 3, "manifest_version is not 3")
    r.check(bool(mf.get("version")), "manifest has no version")
    r.check(bool(mf.get("name")), "manifest has no name")
    r.check(bool(mf.get("description")), "manifest has no description")

    # names() yields (absolute, relative); we need relative -> absolute.
    files = {rel: abspath for abspath, rel in names(src)}
    shipped = [rel for rel in files if not rel.startswith("dist/")]

    # --------------------------------------------------- referenced assets
    refs = []
    for s in mf.get("content_scripts", []):
        refs += s.get("js", []) + s.get("css", [])
    bg = mf.get("background", {})
    refs.append(bg.get("service_worker"))
    for war in mf.get("web_accessible_resources", []):
        refs += war.get("resources", [])
    for rr in mf.get("declarative_net_request", {}).get("rule_resources", []):
        refs.append(rr.get("path"))
    iconmaps = [mf.get("action", {}).get("default_icon"), mf.get("icons")]
    for im in iconmaps:
        if im:
            refs += list(im.values())
    refs.append(mf.get("action", {}).get("default_popup"))
    refs.append(mf.get("options_page"))

    for ref in refs:
        if not ref:
            continue
        r.check(ref in files, f"missing referenced file: {ref}")

    isolated = [s for s in mf.get("content_scripts", []) if s.get("world") != "MAIN"]
    for s in mf.get("content_scripts", []):
        r.check(s.get("run_at") == "document_start", f"content script not at document_start: {s.get('js')}")
        r.check("world" in s, f"content script missing explicit world: {s.get('js')}")
    r.check(
        any("js/state.js" in (s.get("js") or []) for s in isolated),
        "isolated content scripts do not load js/state.js",
    )
    for s in isolated:
        js = s.get("js") or []
        if "js/state.js" in js:
            r.check(js[0] == "js/state.js", "js/state.js is not the first isolated content script")
            break
    guard_text = read(src, "js/background.js").decode("utf-8", "replace") if "js/background.js" in files else ""
    r.check(
        any(s.get("world") == "MAIN" for s in mf.get("content_scripts", []))
        or ("js/main-guard.js" in guard_text and '"MAIN"' in guard_text),
        "main-guard.js is neither a MAIN content script nor dynamically registered",
    )

    # ------------------------------------------------------- rulesets
    for rr in mf.get("declarative_net_request", {}).get("rule_resources", []):
        path = rr.get("path")
        if not path or path not in files:
            continue
        try:
            data = json.loads(read(src, path))
        except Exception as e:
            r.bad.append(f"invalid rules JSON {path}: {e}")
            continue
        r.check(isinstance(data, list), f"{path} is not a rule list")
        ids = [x.get("id") for x in data if isinstance(x, dict)]
        r.check(len(ids) == len(set(ids)), f"{path} has duplicate rule ids")
        for rule in data:
            if not isinstance(rule, dict):
                r.bad.append(f"{path} contains a non-object rule")
                break
            cond = rule.get("condition") or {}
            if not cond.get("urlFilter") and not cond.get("regexFilter") and not cond.get("requestDomains"):
                r.bad.append(f"{path} rule id={rule.get('id')} has no urlFilter/regexFilter")
                break
            r.check(
                cond.get("domainType") == "thirdParty",
                f"{path} rule id={rule.get('id')} is not thirdParty-scoped (can block a site's own requests)",
            )
            risky = {"media", "other", "object", "main_frame"} & set(cond.get("resourceTypes") or [])
            r.check(not risky, f"{path} rule id={rule.get('id')} blocks risky resource types {sorted(risky)}")

    # ----------------------------------------------------------- icons
    for im in iconmaps:
        if not im:
            continue
        for key, path in im.items():
            if path not in files:
                continue
            size = png_size(read(src, path))
            r.check(size == (int(key), int(key)), f"icon {path} is {size}, expected {key}x{key}")

    for key, path in (mf.get("action", {}).get("default_icon") or {}).items():
        if path in files:
            r.check(png_size(read(src, path)) == (int(key), int(key)), f"action icon {path} wrong size")

    # ------------------------------------------------------ javascript
    js_files = [f for f in shipped if f.endswith(".js")]
    try:
        have_node = subprocess.run(["node", "--version"], capture_output=True).returncode == 0
    except Exception:
        have_node = False

    # Remote-import / CDN checks exist to guarantee the *package* stays
    # self-contained; dev-only files (tools/, docs/) legitimately fetch() and
    # use local HTTP servers during the e2e run and testing.
    bundled_js = [f for f in js_files if not f.startswith("tools/") and not f.startswith("docs/")]

    for jf in bundled_js:
        text = read(src, jf).decode("utf-8", "replace")
        r.check(not LEGACY.search(text), f"legacy branding in {jf}")
        r.check(not REMOTE.search(text), f"remote resource reference in {jf}")
        r.check(not CDN_JS.search(text), f"remote import/fetch in {jf}")
        r.check("eval(" not in text.replace("no-eval-if", ""), f"eval() used in {jf}")

    for jf in js_files:
        if have_node:
            p = subprocess.run(["node", "--check", jf if os.path.isdir(src) else _tmp(src, jf)],
                               capture_output=True, cwd=os.getcwd())
            r.check(p.returncode == 0, f"JS syntax error in {jf}: {p.stderr.decode('utf-8','replace')[:200]}")

    # ----------------------------------------------------------- html/css
    for f in shipped:
        if f.endswith((".html", ".css")):
            text = read(src, f).decode("utf-8", "replace")
            r.check(not LEGACY.search(text), f"legacy branding in {f}")

    # ------------------------------------------------------------ report
    print(f"target  : {src}")
    print(f"version : {mf.get('version')}")
    print(f"files   : {len(shipped)}")
    print(f"passed  : {r.ok}")
    if r.bad:
        print(f"failed  : {len(r.bad)}")
        for b in r.bad:
            print(f"  - {b}")
        return 1
    print("result  : OK")
    return 0


_TMP = []


def _tmp(src, rel):
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".js")
    with os.fdopen(fd, "wb") as f:
        f.write(load(src, rel))
    _TMP.append(path)
    return path


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), ".."
    )
    code = main(target)
    for t in _TMP:
        try:
            os.remove(t)
        except OSError:
            pass
    sys.exit(code)
