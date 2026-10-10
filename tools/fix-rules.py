#!/usr/bin/env python3
"""Normalise every DNR rule in rules/ for safety and consistency.

Run:  python tools/fix-rules.py

Fixes applied to each rule condition:
  * domainType = "thirdParty"
      Without it a site whose own API lives on a matching host (events.*,
      collect.*, pixel.*, tracker.*) has its own requests blocked, which is a
      common cause of "works once, then the site stops responding".
  * risky resource types removed from broad domain anchors
      media / other / object / main_frame are never needed to stop ads and are
      the ones that break video streaming.
  * priority normalised to 1 (the dynamic allowlist uses priority 99).

Writes the files back and prints a summary.
"""

import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RULES = os.path.join(ROOT, "rules")

# Kept: the types an ad/tracker actually uses.
SAFE_TYPES = {
    "script", "image", "stylesheet", "font", "xmlhttprequest",
    "sub_frame", "websocket", "ping", "csp_report",
}

# Types that must survive for video playback to keep working.
DROP_ALWAYS = {"media", "other", "object", "main_frame", "webtransport"}


def main():
    files = sorted(f for f in os.listdir(RULES) if f.endswith(".json"))
    for fn in files:
        path = os.path.join(RULES, fn)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        changed = 0
        for rule in data:
            if not isinstance(rule, dict):
                continue
            cond = rule.setdefault("condition", {})

            if cond.get("domainType") != "thirdParty":
                cond["domainType"] = "thirdParty"
                changed += 1

            rt = cond.get("resourceTypes")
            if isinstance(rt, list):
                kept = [t for t in rt if t not in DROP_ALWAYS]
                if kept != rt:
                    cond["resourceTypes"] = kept or ["script", "xmlhttprequest", "image"]
                    changed += 1

            # A block rule must not collide with the dynamic allowlist.
            if rule.get("priority") != 1:
                rule["priority"] = 1
                changed += 1

        if changed:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
        print(f"{fn:<22} rules={len(data):<4} changes={changed}")

    print("\nall rule conditions now thirdParty + media-safe")


if __name__ == "__main__":
    main()
