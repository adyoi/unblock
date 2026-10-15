const STORAGE_KEY = "unblock_settings";
const LEGACY_STORAGE_KEY = "unblock_settings";

const defaultSettings = {
  enabled: true,
  whitelist: [],
  customRules: [],
  cosmeticSelectors: [],
  advancedDefenses: true,
  scriptletsAllowlist: [],
  heuristicsEnabled: true,
  remoteListEnabled: false,
  remoteListUrl: "",
  version: 1
};

const STATIC_RULESET_IDS = ["default-block", "ads-lists-lite", "privacy-lite", "trackers-lite"];
const GUARD_SCRIPT_ID = "unblock-main-guard";
const GUARD_JS = "js/main-guard.js";
const GUARD_WORLD = "MAIN";
const WHITELIST_ID_BASE = 1000;
const WHITELIST_ID_END = 1999;
const WHITELIST_MAX = 500;
const CUSTOM_ID_BASE = 10000;
const CUSTOM_NET_MAX = 2000;
const CUSTOM_REGEX_ID_BASE = 12500;
const CUSTOM_REGEX_MAX = 200;
const CUSTOM_ID_END = 12999;
const CUSTOM_RULE_LIMIT = 5000;
const WHITELIST_PRIORITY = 99;
const REMOTE_CACHE_KEY = "unblock_remote_list";
const REMOTE_ID_BASE = 20000;
const REMOTE_ID_END = 29999;
const REMOTE_MAX = 1500;
const REMOTE_MAX_BYTES = 8 * 1024 * 1024;
const FRAME_TYPES = ["main_frame", "sub_frame"];
const WHITELIST_SUBRESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];
const CUSTOM_RESOURCE_TYPES = [
  "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];
const LOCAL_HOSTS = ["localhost", "local", "intranet"];

function warn(label, err) {
  try {
    console.warn("unblock:", label, err);
  } catch (e) {}
}

async function migrateSettings() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    if (data[STORAGE_KEY]) return data[STORAGE_KEY];
    if (data[LEGACY_STORAGE_KEY]) {
      const migrated = { ...defaultSettings, ...data[LEGACY_STORAGE_KEY], version: 1 };
      await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
      try { await chrome.storage.local.remove(LEGACY_STORAGE_KEY); } catch (e) {}
      return migrated;
    }
  } catch (e) {}
  return null;
}

async function getSettings() {
  const m = await migrateSettings();
  if (m) return m;
  let data = null;
  try {
    data = await chrome.storage.local.get(STORAGE_KEY);
  } catch (e) {}
  return { ...defaultSettings, ...((data && data[STORAGE_KEY]) || {}) };
}

async function saveSettings(settings) {
  const s = { ...defaultSettings, ...settings, version: 1 };
  await chrome.storage.local.set({ [STORAGE_KEY]: s });
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

function sanitizeDomain(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/^[^@]*@/, "");
  const cut = s.search(/[/?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^\*+(\.)?/, "");
  s = s.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!s || s.length > 253) return null;
  if (s.indexOf("..") !== -1) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(s)) return null;
  const labels = s.split(".");
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].length > 63) return null;
  }
  if (labels.length === 1 && LOCAL_HOSTS.indexOf(s) === -1) return null;
  return s;
}

function normalizeWhitelist(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < arr.length && out.length < WHITELIST_MAX; i++) {
    const d = sanitizeDomain(arr[i]);
    if (d && out.indexOf(d) === -1) out.push(d);
  }
  return out;
}

async function updateIcon(settings) {
  const s = settings || (await getSettings());
  const path = s && s.enabled !== false
    ? {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png"
      }
    : {
        16: "icons/icon16-gray.png",
        32: "icons/icon32-gray.png",
        48: "icons/icon48-gray.png",
        128: "icons/icon128-gray.png"
      };
  try {
    await chrome.action.setIcon({ path });
  } catch (e) {}
}

async function applyEnabledState(settings) {
  const want = settings.enabled !== false;
  let current = null;
  try {
    current = await chrome.declarativeNetRequest.getEnabledRulesets();
  } catch (e) {}
  const enable = [];
  const disable = [];
  for (let i = 0; i < STATIC_RULESET_IDS.length; i++) {
    const id = STATIC_RULESET_IDS[i];
    const on = !current || current.indexOf(id) !== -1;
    if (want && !on) enable.push(id);
    if (!want && on) disable.push(id);
  }
  if (!enable.length && !disable.length) return;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRuleIds: enable, disableRuleIds: disable });
  } catch (e) {
    warn("rulesets", e);
  }
}

function buildWhitelistRules(whitelist) {
  const out = [];
  for (let i = 0; i < whitelist.length && i < WHITELIST_MAX; i++) {
    const d = whitelist[i];
    out.push({
      id: WHITELIST_ID_BASE + i * 2,
      priority: WHITELIST_PRIORITY,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [d], resourceTypes: FRAME_TYPES.slice() }
    });
    out.push({
      id: WHITELIST_ID_BASE + i * 2 + 1,
      priority: WHITELIST_PRIORITY,
      action: { type: "allow" },
      condition: { initiatorDomains: [d], resourceTypes: WHITELIST_SUBRESOURCE_TYPES.slice() }
    });
  }
  return out;
}

function buildCustomRules(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  let plain = 0;
  let regex = 0;
  for (let i = 0; i < list.length; i++) {
    if (plain >= CUSTOM_NET_MAX && regex >= CUSTOM_REGEX_MAX) break;
    const s = typeof list[i] === "string" ? list[i].trim() : "";
    if (!s || s.length > 4096) continue;
    if (s.charAt(0) === "!" || s.charAt(0) === "@" || s.charAt(0) === "[") continue;
    if (s.indexOf("##") !== -1 || s.indexOf("#@#") !== -1 || s.indexOf("#?#") !== -1) continue;
    if (s.indexOf("$") !== -1) continue;
    if (/[^\x20-\x7e]/.test(s)) continue;
    const base = { domainType: "thirdParty", resourceTypes: CUSTOM_RESOURCE_TYPES };
    if (s.length > 2 && s.charAt(0) === "/" && s.charAt(s.length - 1) === "/") {
      if (regex >= CUSTOM_REGEX_MAX) continue;
      const inner = s.slice(1, -1);
      if (!inner || inner.length > 1000) continue;
      try {
        new RegExp(inner);
      } catch (e) {
        continue;
      }
      out.push({
        id: CUSTOM_REGEX_ID_BASE + regex,
        priority: 1,
        action: { type: "block" },
        condition: Object.assign({ regexFilter: inner }, base)
      });
      regex++;
      continue;
    }
    if (plain >= CUSTOM_NET_MAX) continue;
    const bare = /^\|\|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?:\/)?$/i.exec(s);
    const wild = /^\|\|\*\.([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?:\/)?$/i.exec(s);
    const hostPart = bare ? bare[1] : wild ? wild[1] : null;
    if (hostPart) {
      const domain = sanitizeDomain(hostPart);
      if (!domain) continue;
      out.push({
        id: CUSTOM_ID_BASE + plain,
        priority: 1,
        action: { type: "block" },
        condition: Object.assign({ requestDomains: [domain] }, base)
      });
      plain++;
      continue;
    }
    if (s.indexOf("||*") === 0) continue;
    if (/^[|*^]+$/.test(s)) continue;
    out.push({
      id: CUSTOM_ID_BASE + plain,
      priority: 1,
      action: { type: "block" },
      condition: Object.assign({ urlFilter: s }, base)
    });
    plain++;
  }
  return out;
}

function sanitizeRemoteUrl(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  if (!/^https:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

// Compile the MV3-safe subset of a remote filter list. Cosmetic rules,
// exceptions, options ($...) and non-ASCII patterns are skipped entirely.
function buildRemoteRules(text) {
  const out = [];
  if (typeof text !== "string" || !text) return out;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < REMOTE_MAX; i++) {
    const s = lines[i].trim();
    if (!s || s.length > 4096) continue;
    if (s.charAt(0) === "!" || s.charAt(0) === "@" || s.charAt(0) === "[") continue;
    if (s.indexOf("##") !== -1 || s.indexOf("#@#") !== -1 || s.indexOf("#?#") !== -1) continue;
    if (s.indexOf("$") !== -1) continue;
    if (/[^\x20-\x7e]/.test(s)) continue;
    const base = { domainType: "thirdParty", resourceTypes: CUSTOM_RESOURCE_TYPES };
    if (s.length > 2 && s.charAt(0) === "/" && s.charAt(s.length - 1) === "/") {
      const inner = s.slice(1, -1);
      if (!inner || inner.length > 1000) continue;
      try {
        new RegExp(inner);
      } catch (e) {
        continue;
      }
      out.push({ id: REMOTE_ID_BASE + out.length, priority: 1, action: { type: "block" }, condition: Object.assign({ regexFilter: inner }, base) });
      continue;
    }
    const bare = /^\|\|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\^?\/?$/i.exec(s);
    const wild = /^\|\|\*\.([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\^?\/?$/i.exec(s);
    const hostPart = bare ? bare[1] : wild ? wild[1] : null;
    if (hostPart) {
      const domain = sanitizeDomain(hostPart);
      if (!domain) continue;
      out.push({ id: REMOTE_ID_BASE + out.length, priority: 1, action: { type: "block" }, condition: Object.assign({ requestDomains: [domain] }, base) });
      continue;
    }
    if (s.indexOf("||*") === 0) continue;
    if (/^[|*^]+$/.test(s)) continue;
    out.push({ id: REMOTE_ID_BASE + out.length, priority: 1, action: { type: "block" }, condition: Object.assign({ urlFilter: s }, base) });
  }
  return out;
}

async function readRemoteCache() {
  try {
    const data = await chrome.storage.local.get(REMOTE_CACHE_KEY);
    const c = data && data[REMOTE_CACHE_KEY];
    if (c && typeof c === "object") return c;
  } catch (e) {}
  return null;
}

async function writeRemoteCache(cache) {
  try {
    await chrome.storage.local.set({ [REMOTE_CACHE_KEY]: cache });
  } catch (e) {}
}

async function applyRemoteDnr(settings) {
  let wanted = [];
  const enabled = settings.enabled !== false && settings.remoteListEnabled === true;
  const url = sanitizeRemoteUrl(settings.remoteListUrl || "");
  if (enabled && url) {
    const cache = await readRemoteCache();
    if (cache && cache.url === url && typeof cache.text === "string") {
      wanted = buildRemoteRules(cache.text);
    }
  }
  await applyDynamicRules(wanted, (id) => id >= REMOTE_ID_BASE && id <= REMOTE_ID_END, "remote");
}

// Opt-in only. Fetches the user-supplied HTTPS list with no credentials and no
// referrer, keeps an ETag/Last-Modified cache locally, and never contacts any
// third party.
async function syncRemoteList(settings) {
  const s = settings || (await getSettings());
  const url = sanitizeRemoteUrl(s.remoteListUrl || "");
  if (!url) {
    await applyRemoteDnr(s);
    return { ok: false, error: "invalid_url" };
  }
  if (s.enabled === false || s.remoteListEnabled !== true) {
    await applyRemoteDnr(s);
    const cache = await readRemoteCache();
    const fresh = cache && cache.url === url;
    return { ok: true, status: "disabled", count: fresh ? cache.count || 0 : 0, url };
  }
  const prev = await readRemoteCache();
  const headers = {};
  if (prev && prev.url === url) {
    if (prev.etag) headers["If-None-Match"] = prev.etag;
    if (prev.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  }
  let res;
  try {
    res = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "follow", headers });
  } catch (e) {
    await applyRemoteDnr(s);
    return { ok: false, error: "network" };
  }
  if (res.status === 304 && prev && prev.url === url && typeof prev.text === "string") {
    const cache = Object.assign({}, prev, { fetchedAt: Date.now() });
    await writeRemoteCache(cache);
    await applyRemoteDnr(s);
    return { ok: true, status: "not-modified", count: buildRemoteRules(cache.text).length, url };
  }
  if (!res.ok) {
    await applyRemoteDnr(s);
    return { ok: false, error: "http_" + res.status };
  }
  let text;
  try {
    text = await res.text();
  } catch (e) {
    await applyRemoteDnr(s);
    return { ok: false, error: "read_failed" };
  }
  if (typeof text !== "string" || text.length > REMOTE_MAX_BYTES) {
    await applyRemoteDnr(s);
    return { ok: false, error: "too_large" };
  }
  const rules = buildRemoteRules(text);
  const header = (name) => (res.headers && res.headers.get ? res.headers.get(name) || "" : "");
  const cache = {
    url,
    etag: header("etag"),
    lastModified: header("last-modified"),
    fetchedAt: Date.now(),
    hash: fnv1a(text),
    count: rules.length,
    text
  };
  await writeRemoteCache(cache);
  await applyRemoteDnr(s);
  return { ok: true, status: "updated", count: rules.length, url };
}

async function applyDynamicRules(wanted, inRange, label) {
  let current = [];
  try {
    current = (await chrome.declarativeNetRequest.getDynamicRules()) || [];
  } catch (e) {
    warn(label + ":read", e);
    return;
  }
  const wantedJson = new Map();
  for (let i = 0; i < wanted.length; i++) wantedJson.set(wanted[i].id, JSON.stringify(wanted[i]));
  const currentJson = new Map();
  for (let i = 0; i < current.length; i++) {
    if (inRange(current[i].id)) currentJson.set(current[i].id, JSON.stringify(current[i]));
  }
  const removeRuleIds = [];
  currentJson.forEach((json, id) => {
    if (!wantedJson.has(id)) removeRuleIds.push(id);
  });
  const plain = [];
  const regex = [];
  for (let i = 0; i < wanted.length; i++) {
    const rule = wanted[i];
    const now = currentJson.get(rule.id);
    if (now === wantedJson.get(rule.id)) continue;
    if (now !== undefined) removeRuleIds.push(rule.id);
    if (rule.condition.regexFilter) regex.push(rule);
    else plain.push(rule);
  }
  if (removeRuleIds.length) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    } catch (e) {
      warn(label + ":remove", e);
      return;
    }
  }
  if (plain.length) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: plain });
    } catch (e) {
      warn(label + ":add", e);
      return;
    }
  }
  if (regex.length) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: regex });
    } catch (e) {
      warn(label + ":regex", e);
    }
  }
}

async function applyWhitelistDnr(settings) {
  await applyDynamicRules(
    buildWhitelistRules(settings.whitelist || []),
    (id) => id >= WHITELIST_ID_BASE && id <= WHITELIST_ID_END,
    "whitelist"
  );
}

async function applyCustomDnr(settings) {
  const wanted = settings.enabled !== false ? buildCustomRules(settings.customRules) : [];
  await applyDynamicRules(
    wanted,
    (id) => id >= CUSTOM_ID_BASE && id <= CUSTOM_ID_END,
    "custom"
  );
}

function guardExcludeMatches(whitelist) {
  const out = [];
  for (let i = 0; i < whitelist.length; i++) {
    const d = whitelist[i];
    out.push("*://" + d + "/*", "*://*." + d + "/*");
  }
  return out;
}

function sameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

let guardSync = null;
async function syncGuard(settings) {
  // top-level syncAll() can race with onInstalled/onStartup syncAll(). A
  // second registerContentScripts call with the same id throws
  // "Duplicate script ID", which silently left the guard unregistered.
  // Serialize all guard syncs through one in-flight promise.
  if (guardSync) return guardSync;
  guardSync = (async () => {
    let registered = null;
    try {
      registered = await chrome.scripting.getRegisteredContentScripts();
    } catch (e) {
      warn("guard:read", e);
      return;
    }
    if (!Array.isArray(registered)) return;
    const current = registered.filter((s) => s && s.id === GUARD_SCRIPT_ID)[0] || null;
    const want = settings.enabled !== false && settings.advancedDefenses !== false;
    if (!want) {
      if (current) {
        try {
          await chrome.scripting.unregisterContentScripts({ ids: [GUARD_SCRIPT_ID] });
        } catch (e) {
          warn("guard:off", e);
        }
      }
      return;
    }
    const spec = {
      id: GUARD_SCRIPT_ID,
      js: [GUARD_JS],
      matches: ["<all_urls>"],
      excludeMatches: guardExcludeMatches(settings.whitelist || []),
      runAt: "document_start",
      allFrames: true,
      world: GUARD_WORLD,
      persistAcrossSessions: true
    };
    if (
      current &&
      sameList(current.js, spec.js) &&
      sameList(current.matches, spec.matches) &&
      sameList(current.excludeMatches, spec.excludeMatches) &&
      current.runAt === spec.runAt &&
      !!current.allFrames === spec.allFrames &&
      current.world === spec.world
    ) {
      return;
    }
    if (current) {
      try {
        await chrome.scripting.unregisterContentScripts({ ids: [GUARD_SCRIPT_ID] });
      } catch (e) {
        warn("guard:replace", e);
        return;
      }
    }
    try {
      await chrome.scripting.registerContentScripts([spec]);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.indexOf("Duplicate script ID") !== -1) return;
      warn("guard:on", e);
    }
  })().finally(() => {
    guardSync = null;
  });
  return guardSync;
}

async function syncAll(settings) {
  const s = settings || (await getSettings());
  await Promise.all([
    updateIcon(s),
    applyEnabledState(s),
    applyWhitelistDnr(s),
    applyCustomDnr(s),
    applyRemoteDnr(s),
    syncGuard(s)
  ]);
}

async function commit(settings) {
  await saveSettings(settings);
  await syncAll(settings);
}

chrome.runtime.onInstalled.addListener(() => {
  syncAll().catch(() => {});
});
chrome.tabs.onActivated.addListener(() => {
  updateIcon().catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo && (changeInfo.status === "loading" || changeInfo.url)) {
    updateIcon().catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => {
  syncAll().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Any throw inside this handler would leave sendResponse uncalled: the popup
  // would then render empty defaults, so the master switch appears to snap
  // straight back and the toolbar icon never changes.
  (async () => {
    try {
      await handleMessage(msg, sender, sendResponse);
    } catch (e) {
      try {
        const settings = await getSettings().catch(() => ({ ...defaultSettings }));
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e), settings });
      } catch (e2) {
        sendResponse({ ok: false, error: "handler_failed", settings: { ...defaultSettings } });
      }
    }
  })();
  return true;
});

async function handleMessage(msg, sender, sendResponse) {
  if (!msg || typeof msg !== "object") {
    sendResponse({ ok: false, error: "unknown" });
    return;
  }
  const settings = await getSettings();
  if (!settings.whitelist) settings.whitelist = [];
  if (!settings.customRules) settings.customRules = [];
  if (!settings.scriptletsAllowlist) settings.scriptletsAllowlist = [];

  if (msg.type === "getSettings") {
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "toggle") {
    settings.enabled = !!msg.enabled;
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "addWhitelist") {
    const d = sanitizeDomain(msg.domain || (msg.url ? domainFromUrl(msg.url) : ""));
    if (!d) {
      sendResponse({ ok: false, error: "invalid_domain", settings });
      return;
    }
    if (settings.whitelist.indexOf(d) === -1) {
      if (settings.whitelist.length >= WHITELIST_MAX) {
        sendResponse({ ok: false, error: "limit", settings });
        return;
      }
      settings.whitelist.push(d);
      await commit(settings);
    }
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "removeWhitelist") {
    settings.whitelist = settings.whitelist.filter((x) => x !== msg.domain);
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "clearWhitelist") {
    settings.whitelist = [];
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "setWhitelist") {
    settings.whitelist = normalizeWhitelist(msg.domains);
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "saveCustomRules") {
    const rules = Array.isArray(msg.rules) ? msg.rules : [];
    if (rules.length > CUSTOM_RULE_LIMIT) {
      sendResponse({ ok: false, error: "too_many_rules", settings });
      return;
    }
    settings.customRules = rules
      .map((r) => (typeof r === "string" ? r.trim().slice(0, 4096) : ""))
      .filter((r) => r);
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "addCustomRule") {
    const r = typeof msg.rule === "string" ? msg.rule.trim().slice(0, 4096) : "";
    if (!r) {
      sendResponse({ ok: false, error: "invalid_rule", settings });
      return;
    }
    if (settings.customRules.indexOf(r) === -1) {
      if (settings.customRules.length >= CUSTOM_RULE_LIMIT) {
        sendResponse({ ok: false, error: "limit", settings });
        return;
      }
      settings.customRules.push(r);
      await commit(settings);
    }
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "removeCustomRule") {
    const r = typeof msg.rule === "string" ? msg.rule.trim().slice(0, 4096) : "";
    if (!r) {
      sendResponse({ ok: false, error: "invalid_rule", settings });
      return;
    }
    const i = settings.customRules.indexOf(r);
    if (i !== -1) {
      settings.customRules.splice(i, 1);
      await commit(settings);
    }
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "setAdvancedDefenses") {
    settings.advancedDefenses = !!msg.enabled;
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "setHeuristics") {
    settings.heuristicsEnabled = msg.enabled !== false;
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "toggleScriptletsAllowlist") {
    const d = sanitizeDomain(msg.domain || "");
    if (!d) {
      sendResponse({ ok: false, error: "invalid_domain", settings });
      return;
    }
    const i = settings.scriptletsAllowlist.indexOf(d);
    if (i === -1) settings.scriptletsAllowlist.push(d);
    else settings.scriptletsAllowlist.splice(i, 1);
    await commit(settings);
    sendResponse({ ok: true, settings });
    return;
  }
  if (msg.type === "startPicker") {
    const tabId =
      typeof msg.tabId === "number"
        ? msg.tabId
        : sender && sender.tab && typeof sender.tab.id === "number"
          ? sender.tab.id
          : null;
    if (typeof tabId === "number") {
      let active = false;
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: "pickerStateQuery" });
        active = !!(res && res.active);
      } catch (e) {}
      if (active) {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "pickerStop" });
        } catch (e) {}
        sendResponse({ ok: true, active: false });
        return;
      }
      try {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ["css/picker.css"] });
      } catch (e) {}
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["js/picker.js"], world: GUARD_WORLD });
      } catch (e) {}
      try {
        await chrome.tabs.sendMessage(tabId, { type: "pickerStarted" });
      } catch (e) {}
      sendResponse({ ok: true, active: true });
      return;
    }
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "pickerEnded") {
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "pickerState") {
    const tabId =
      typeof msg.tabId === "number"
        ? msg.tabId
        : sender && sender.tab && typeof sender.tab.id === "number"
          ? sender.tab.id
          : null;
    let active = false;
    if (typeof tabId === "number") {
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: "pickerStateQuery" });
        active = !!(res && res.active);
      } catch (e) {}
    }
    sendResponse({ ok: true, active });
    return;
  }
  if (msg.type === "getRemoteListStatus") {
    const url = sanitizeRemoteUrl(settings.remoteListUrl || "");
    const cache = await readRemoteCache();
    const fresh = !!(cache && cache.url === url);
    sendResponse({
      ok: true,
      settings,
      remote: {
        enabled: settings.remoteListEnabled === true,
        url: url || "",
        count: fresh ? cache.count || 0 : 0,
        fetchedAt: fresh ? cache.fetchedAt || 0 : 0,
        hash: fresh ? cache.hash || "" : ""
      }
    });
    return;
  }
  if (msg.type === "setRemoteList") {
    const enabled = msg.enabled === true;
    const url = msg.url ? sanitizeRemoteUrl(msg.url) : "";
    if (enabled && !url) {
      sendResponse({ ok: false, error: "invalid_url", settings });
      return;
    }
    settings.remoteListEnabled = enabled;
    settings.remoteListUrl = url || "";
    await saveSettings(settings);
    let remote;
    if (enabled) {
      remote = await syncRemoteList(settings);
    } else {
      await applyRemoteDnr(settings);
      remote = { ok: true, status: "disabled", count: 0, url: "" };
    }
    sendResponse({ ok: true, settings, remote });
    return;
  }
  if (msg.type === "syncRemoteList") {
    if (settings.remoteListEnabled !== true) {
      await applyRemoteDnr(settings);
      sendResponse({ ok: false, error: "not_enabled", settings });
      return;
    }
    const remote = await syncRemoteList(settings);
    sendResponse({ ok: true, settings, remote });
    return;
  }
  sendResponse({ ok: false, error: "unknown" });
}

syncAll().catch(() => {});
