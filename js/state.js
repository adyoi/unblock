(() => {
  const KEY = "unblock_settings";
  const DEFAULTS = {
    enabled: true,
    whitelist: [],
    customRules: [],
    cosmeticSelectors: [],
    advancedDefenses: true,
    scriptletsAllowlist: [],
    heuristicsEnabled: true,
    version: 1
  };
  const MAX_CUSTOM_SELECTORS = 2000;
  let snapshot = null;
  let loading = false;
  const subscribers = [];

  function pageHost() {
    try {
      const h = location.hostname;
      if (h) return h.toLowerCase();
    } catch (e) {}
    try {
      const h = top.location.hostname;
      if (h) return h.toLowerCase();
    } catch (e) {}
    try {
      const ref = document.referrer;
      if (ref) {
        const h = new URL(ref).hostname;
        if (h) return h.toLowerCase();
      }
    } catch (e) {}
    return "";
  }

  function parseCustomSelectors(rules) {
    const out = [];
    if (!Array.isArray(rules)) return out;
    for (let i = 0; i < rules.length && out.length < MAX_CUSTOM_SELECTORS; i++) {
      const line = rules[i];
      if (typeof line !== "string") continue;
      const s = line.trim();
      if (!s || s.charAt(0) === "!") continue;
      if (s.indexOf("#?#") !== -1 || s.indexOf("#@#") !== -1) continue;
      const at = s.indexOf("##");
      if (at === -1) continue;
      const sel = s.slice(at + 2).trim();
      if (sel) out.push(sel);
    }
    return out;
  }

  function isWhitelisted(host, whitelist) {
    if (!host) return false;
    for (let i = 0; i < whitelist.length; i++) {
      const d = whitelist[i];
      if (!d) continue;
      if (host === d) return true;
      if (host.length > d.length && host.charAt(host.length - d.length - 1) === "." && host.slice(host.length - d.length) === d) {
        return true;
      }
    }
    return false;
  }

  function build(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    const host = pageHost();
    const whitelist = Array.isArray(s.whitelist) ? s.whitelist : [];
    const allowlist = Array.isArray(s.scriptletsAllowlist) ? s.scriptletsAllowlist : [];
    const enabled = s.enabled !== false;
    const allowed = isWhitelisted(host, whitelist);
    const active = enabled && !allowed;
    return {
      host,
      enabled,
      active,
      allowed,
      advanced: active && s.advancedDefenses !== false,
      heuristics: active && s.heuristicsEnabled !== false,
      scriptlets: active && allowlist.indexOf(host) === -1,
      customSelectors: active ? parseCustomSelectors(s.customRules) : []
    };
  }

  function notify() {
    for (let i = 0; i < subscribers.length; i++) {
      try {
        subscribers[i](snapshot);
      } catch (e) {}
    }
  }

  function setSnapshot(raw) {
    snapshot = build(raw);
    notify();
  }

  function startLoad() {
    if (loading) return;
    loading = true;
    try {
      const got = chrome.storage.local.get(KEY);
      if (got && typeof got.then === "function") {
        got
          .then((data) => setSnapshot(data && data[KEY]))
          .catch(() => setSnapshot(null));
        return;
      }
    } catch (e) {}
    setSnapshot(null);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes || !changes[KEY]) return;
      setSnapshot(changes[KEY].newValue);
    });
  } catch (e) {}

  window.__uboState = {
    ready: () => snapshot,
    subscribe(fn) {
      if (typeof fn !== "function") return;
      subscribers.push(fn);
      if (snapshot) {
        try {
          fn(snapshot);
        } catch (e) {}
      } else {
        startLoad();
      }
    },
    customSelectors: () => (snapshot && snapshot.customSelectors) || []
  };

  startLoad();
})();
