// Unblock - minimal i18n helper (classic script, shared by popup + options).
// Falls back to the supplied literal whenever chrome.i18n is unavailable, so
// the UI still renders in devtools-less contexts (e.g. file:// previews).
(function () {
  function t(key, fallback, subs) {
    try {
      if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getMessage) {
        const msg = chrome.i18n.getMessage(key, subs);
        if (msg) return msg;
      }
    } catch (e) {}
    return fallback != null ? fallback : key;
  }

  function applyStaticI18n(root) {
    const scope = root || document;
    let nodes = [];
    try {
      nodes = scope.querySelectorAll("[data-i18n]");
    } catch (e) {
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const key = el.getAttribute("data-i18n");
      if (!key) continue;
      const fallback = el.getAttribute("data-i18n-fallback") || el.textContent;
      el.textContent = t(key, fallback);
    }
  }

  window.__unblockI18n = { t: t, applyStaticI18n: applyStaticI18n };
})();
