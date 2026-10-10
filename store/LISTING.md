# Chrome Web Store listing

Copy-paste ready submission data for Unblock.

## Item details

| Field | Value |
|---|---|
| Language | English (United States) |
| Category | Privacy |
| Listing visibility | Public |
| Homepage URL | `https://adyoi.github.io/unblock/` |
| Support URL | `https://github.com/adyoi/unblock/issues` |
| Privacy policy URL | `https://adyoi.github.io/unblock/privacy.html` |

## Short description (max 132 characters)

```
Blocks ads, trackers, popups and intrusive elements. No telemetry, no tracking, 100% open source.
```

That's 108 characters.

## Detailed description

```
Unblock is a lightweight, privacy-first content blocker built for the modern Chrome extension platform (Manifest V3).

It combines browser-native network filtering with cosmetic filtering and a small, auditable scriptlets engine to remove ads, trackers, telemetry beacons, popups and intrusive page elements — without slowing down your browsing.

WHAT IT BLOCKS
• Ad network requests across the common ad-serving domains
• Analytics, telemetry and cross-site tracking endpoints
• Ad and tracking scripts injected into pages
• Intrusive page elements such as ad slots, interstitials and sticky banners
• Popup and new-tab hijacking attempts triggered by page scripts

WHAT IT GIVES YOU
• One master switch, on the toolbar
• Per-site whitelisting with one click
• An Element Picker: click any element on a page and it is blocked
• An Options page for your own custom rules, with JSON import and export
• A small set of defensive scriptlets that reduce adblock-detection breakage
• An icon that clearly shows whether blocking is active

PRIVACY FIRST
Unblock has no analytics, no telemetry, no crash reporting and no accounts. It makes no network requests of its own — it only decides locally whether a request you were already making should be allowed or blocked. Everything you configure stays in your browser profile via local storage.

NO REMOTE CODE
The entire extension — styles, scripts and filter lists — ships inside the package. There is no remote script execution and no CDN dependency, so the behaviour you review is the behaviour you get.

HONEST ABOUT LIMITS
Unblock is not a complete replacement for every feature of a full-featured filter browser. Manifest V3 removed several filtering capabilities (real-time dynamic filtering, response-body replacement, redirect rules, CNAME uncloaking and a live request logger). Unblock implements the reliable subset and documents exactly what is not supported instead of pretending otherwise.

Built with Manifest V3, declarativeNetRequest, cosmetic selectors, scriptlets and an Element Picker. Open source and MIT licensed.
```

## Assets

| Asset | File | Requirement |
|---|---|---|
| Extension icon | `store/icon-128.png` | 128 x 128 PNG, under 1 MB |
| Small promo tile | `store/small-tile.png` | 440 x 280 PNG/JPG |
| Marquee tile | `store/marquee.png` | 920 x 280 PNG/JPG |
| Screenshot 1 | `store/screenshot-1.png` | 1280 x 800 (popup, real UI capture) |
| Screenshot 2 | `store/screenshot-2.png` | 1280 x 800 (options, real UI capture) |
| Screenshot 3 | `store/screenshot-3.png` | 1280 x 800 (element picker, generated) |

Screenshots 1 and 2 are real captures of the shipped UI in headless
Chrome:

```bash
node tools/shot-ui.js
```

Icons, tiles and screenshot 3 are generated:

```bash
python tools/generate-icons.py
python tools/generate-store-assets.py
```

To refresh only the icons and promo tiles while keeping the real
screenshots:

```bash
python tools/generate-store-assets.py --promo-only
```

## Submission checklist

- [ ] `python tools/pack.py` produces `dist/unblock-<version>.zip`
- [ ] Zip contains `manifest.json` at the archive root
- [ ] Zip contains no `_metadata/`, no `store/`, no `tools/`, no `docs/`, no `README.md`
- [ ] Version in `manifest.json` matches the tag you are releasing
- [ ] Privacy policy URL is live and reachable
- [ ] Support URL points at a real issues page
- [ ] Tested on a fresh Chrome profile with no other extensions
- [ ] Screenshots show no personal data, no third-party logos
- [ ] Listing text matches the shipped behaviour (no claims about unavailable features)
