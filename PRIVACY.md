# Privacy Policy

**Unblock** — last updated: 5 October 2026

## Short version

Unblock does not collect, transmit, sell, or share any personal data. There are
no analytics, no telemetry, no crash reporting, no remote logging, no account
system, and no advertising. Everything the extension needs stays on your device.

## What the extension stores

All data is written to `chrome.storage.local` on your own browser profile and is
never sent anywhere.

| Key | Purpose |
|---|---|
| `enabled` | Master on/off switch |
| `whitelist` | List of hostnames you chose to allow |
| `customRules` | Rules you wrote or created with the Element Picker |
| `cosmeticSelectors` | Reserved for future cosmetic rules |
| `advancedDefenses` | Toggle for the defensive scriptlet layer |
| `heuristicsEnabled` | Toggle for heuristic cosmetic hiding |
| `scriptletsAllowlist` | Sites where you disabled auto-scriptlets |
| `version` | Settings schema version, used for migrations |

If you previously used an earlier build that stored settings under
`ubolite_settings`, Unblock migrates that data **locally** into
`unblock_settings` and then stops using the old key. No data leaves the device
during migration.

## Network activity

Unblock performs **no outbound requests of its own**. It contains no CDN links,
no remote script imports, no update pings, and no font or telemetry endpoints.

The only network requests Unblock *observes* are the ordinary page requests
loaded by the websites you visit, which the browser handles. Unblock inspects
their URLs locally against rule lists to decide what to block — that decision is
made entirely on your machine.

## Permissions and why they are needed

| Permission | Why |
|---|---|
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | Apply the bundled block rules. Requests are handled by the browser, not by a proxy. |
| `<all_urls>` host access | Required so content scripts and rules can run on the sites you visit. |
| `storage` | Save your settings, whitelist and custom rules locally. |
| `tabs` | Read the active tab's hostname for the "Whitelist site" button. |
| `activeTab` | Inject the Element Picker into the current tab when you click the button. |
| `scripting` | Inject the Element Picker overlay on demand. |
| `unlimitedStorage` | Room for large custom rule lists. |
| `userScripts` | Reserved for user-supplied rules; not used for remote code. |

## Third parties

None. Unblock has no third-party SDKs, no partner scripts, and no affiliate
links. Rule lists are bundled locally in the extension package.

## Children

Unblock is not directed at children and collects no data from anyone.

## Changes

If a future version changes what is stored or transmitted, this policy will be
updated in the repository before that version is released, and the "last
updated" date above will change.

## Contact

Questions or requests: open an issue on the project's GitHub repository, or use
the support URL listed in the Chrome Web Store listing.

## Removal

Uninstalling the extension from `chrome://extensions/` permanently deletes all
of its locally stored data.
