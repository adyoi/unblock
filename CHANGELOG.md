# Changelog

All notable changes to Unblock are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Backunder / clickunder chain (Videcloud-style players).** Two new layers
  stop the redirect chain that kicks the playing tab from its video page to an
  ad host (`brotcdn.xyz` player -> `hai8g.com` -> `my.rtmark.net` -> search
  engine):
  - A **cooldown-key lie**: on known ad-chain hosts the guard answers
    `Storage.getItem` for keys prefixed `last_backunder_time_` with a fresh
    timestamp. Redirectors gate on that key (20-minute cooldown) to decide
    between a tab "backunder" (`window.open(currentUrl)` + `location.href` to
    the ad) and a plain popup; faking it skips the damaging branch entirely.
  - A **host blacklist** (`brotcdn.xyz`, `hai8g.com`, plus subdomains): any
    navigation, `window.open`, anchor/AREA/SVG link or form targeting those
    hosts is cancelled even when the URL carries no obvious ad word. This also
    fixes `isBlockedSite()` failing on scheme-less hostnames (a bare hostname
    made `new URL()` throw, quietly disabling the blacklist).
- **Hardened seals** closed additional escape routes: `form.submit()` (fires no
  `submit` event), SVG `<a>` elements (lowercase `tagName`) and image-map
  `AREA` elements, plus `location.href ==`/`location =` direct assignment via
  the own accessor where configurable.
- **Registration race** in `syncGuard()`: concurrent `syncAll()` calls could
  throw "Duplicate script ID" and silently leave the guard unregistered; all
  guard syncs now serialize through one in-flight promise.

### Added

- DNR rules `||hai8g.com^` and `||brotcdn.xyz^` (static, third-party only).
- E2E harness for the brotcdn chain:
  `tools/e2e-brotcdn.js` (live fresh-profile probe, control vs guarded),
  `tools/e2e-brotcdn-cycle.js` (fresh vs refresh cycle with branch evidence)
  and `tools/dnr-test.js` (records that Chrome DNR cannot block
  script-initiated `main_frame` navigations).

### Notes

- **Platform limitation, verified by probe**: Chrome's
  `declarativeNetRequest` blocks subresources but not `main_frame`
  navigations initiated by page scripts (`location.assign`/`location.href`),
  and `location.href` is an own, non-configurable accessor, so it cannot be
  wrapped in JS. The workable surface is the guard's runtime seals plus the
  cooldown-key lie; see `tools/dnr-test.js` and `tools/e2e-brotcdn-cycle.js`.

## [1.0.0] - 2026-10-09

First public release. Built natively for Manifest V3.

### Added

- **Network filtering (declarativeNetRequest)** with four bundled static
  rulesets: `default-block`, `ads-lists-lite`, `privacy-lite` and `trackers-lite`.
  Rules are resource-type aware and `thirdParty`-scoped, and never target
  `main_frame`, `media`, `object` or `other`, so a site's own traffic and video
  streaming are left alone.
- **Per-site whitelisting** backed by persistent `storage.local` state. Each
  entry installs a priority `allowAllRequests` rule for frames plus an
  `allow` rule for subresources initiated by the site, so a trusted page stays
  fully unblocked without disabling the extension everywhere.
- **Master switch** on the toolbar that enables/disables every static ruleset
  and clears the dynamic rules, with a colour/grayscale icon that reflects state.
- **Popup UI**: toggle blocking, allow/unblock the current site, manage the
  whitelist, and launch the Element Picker.
- **Options page**: edit custom rules and the whitelist, with JSON import/export.
- **Element Picker**: overlays the page to select an element and saves it as a
  cosmetic `##selector` custom rule.
- **Custom rules engine**: adblock-style lines are parsed into safe DNR
  primitives — `||domain` becomes `requestDomains`, `/regex/` becomes a
  validated `regexFilter`, plain patterns become `urlFilter`, and `##selector`
  lines become cosmetic selectors. Comments, header lines, option-bearing rules
  and non-ASCII patterns are skipped, and every rule is capped and range-scoped
  so a bad entry can never fail the whole batch.
- **Cosmetic filtering**: generic ad/slot hiding plus a `MutationObserver` that
  catches dynamically injected elements, with ownership markers so scripts
  never corrupt each other's hidden elements.
- **Scriptlets engine**: a small, auditable subset of common anti-adblock
  defenses (`no-adblocker`, `set-constant`, `json-prune`, `remove-attr`,
  `prevent-setTimeout`, `prevent-setInterval`, `no-eval-if`), plus lightweight
  baseline mitigations applied at `document_start`.
- **Popup / new-tab guard** (MAIN world): intercepts `window.open`, programmatic
  anchor clicks, `target=_blank` forms and ad-pattern navigations to stop popup
  and popunder hijacking, while explicitly exempting media players and controls
  so playback keeps working.
- **Advanced defenses and heuristics toggles** that gate the MAIN-world guard
  and the built-in cosmetic heuristics independently.

### Security

- No analytics, telemetry, crash reporting or accounts. No network requests of
  the extension's own; filter lists and scripts ship inside the package with no
  remote code.

### Notes

- Manifest V3 cannot express several classic MV2/`webRequest` capabilities
  (dynamic per-request filtering, `removeparam`, response-body `replace`,
  redirect rules, CNAME uncloaking, live request logging). Unblock implements
  the reliable subset and documents the gaps in `README.md` instead of
  pretending otherwise.

[1.0.0]: https://github.com/adyoi/unblock/releases/tag/v1.0.0
