(() => {
  const SELECTORS = [
    '[id^="ad-"]',
    '[id^="ads-"]',
    '[id^="advert"]',
    '[class^="ad-"]',
    '[class^="ads-"]',
    '[class^="advert"]',
    '[data-ad]',
    '[data-ad-slot]',
    '.google-auto-placed',
    '.adsbygoogle',
    'ins.adsbygoogle'
  ];
  const OWNER = "content";
  const NEVER_HIDE = new Set(["VIDEO", "AUDIO", "SOURCE", "TRACK"]);
  let HIDDEN = new WeakSet();
  let filtering = false;
  let scriptletsRan = false;
  let pickerArmed = false;
  let armTimer = 0;

  function isProtected(el) {
    if (!el || el.nodeType !== 1) return true;
    if (NEVER_HIDE.has(el.tagName)) return true;
    try {
      if (el.hasAttribute("controls")) return true;
      if (el.closest("video,audio")) return true;
    } catch (e) {}
    return false;
  }

  function restoreEl(el) {
    const prev = el.getAttribute("data-unblock-orig") || "";
    const prio = el.getAttribute("data-unblock-orig-prio") || "";
    if (prev) el.style.setProperty("display", prev, prio);
    else el.style.removeProperty("display");
    el.removeAttribute("data-unblock-orig");
    el.removeAttribute("data-unblock-orig-prio");
    el.removeAttribute("data-unblock-hidden");
  }

  function restore() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[data-unblock-hidden="' + OWNER + '"]');
    } catch (e) {
      return;
    }
    for (let i = 0; i < nodes.length; i++) restoreEl(nodes[i]);
    HIDDEN = new WeakSet();
  }

  function hide() {
    if (!filtering) return;
    for (let i = 0; i < SELECTORS.length; i++) {
      try {
        const nodes = document.querySelectorAll(SELECTORS[i]);
        for (let j = 0; j < nodes.length; j++) {
          const el = nodes[j];
          if (HIDDEN.has(el)) {
            if (el.getAttribute("data-unblock-hidden") === OWNER) continue;
            HIDDEN.delete(el);
          }
          if (el.getAttribute("data-unblock-hidden")) continue;
          if (isProtected(el)) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          try {
            const prev = el.style.getPropertyValue("display");
            const prio = el.style.getPropertyPriority("display");
            el.setAttribute("data-unblock-orig", prev);
            el.setAttribute("data-unblock-orig-prio", prio);
            el.setAttribute("data-unblock-hidden", OWNER);
            el.style.setProperty("display", "none", "important");
            HIDDEN.add(el);
          } catch (e) {}
        }
      } catch (e) {}
    }
  }

  function runScriptlets() {
    const site = location.hostname.toLowerCase();
    let auto = [];
    if (site.includes("youtube.com") || site.includes("youtu.be")) {
      auto = [
        { name: "set-constant", args: ["yt.ads.js.controller._impl.pubads.loaded", true] },
        { name: "set-constant", args: ["yt.ads_._loaded", true] },
        { name: "set-constant", args: ["playerResponse.adPlacements", []] },
        "no-adblocker"
      ];
    } else {
      auto = ["no-adblocker"];
    }
    if (window.__uboScriptlets && window.__uboScriptlets.run) {
      try {
        window.__uboScriptlets.run(auto);
      } catch (e) {}
    }
  }

  function applyState(s) {
    if (!s) return;
    const was = filtering;
    filtering = !!s.active && !!s.heuristics;
    if (filtering) hide();
    else if (was) restore();
    if (!scriptletsRan && s.scriptlets) {
      scriptletsRan = true;
      runScriptlets();
    }
  }

  if (window.__uboState && window.__uboState.subscribe) {
    window.__uboState.subscribe(applyState);
  }

  const mo = new MutationObserver(hide);
  if (document.body || document.documentElement) {
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hide, { once: true });
  }
  hide();
  setTimeout(hide, 800);
  setTimeout(hide, 1500);

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "pickerStarted") {
        pickerArmed = true;
        if (armTimer) clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          pickerArmed = false;
        }, 120000);
      }
    });
  } catch (e) {}

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data) return;
    if (ev.data.type !== "UNBLOCK_PICKED" || typeof ev.data.selector !== "string") return;
    if (!pickerArmed) return;
    const sel = ev.data.selector.slice(0, 400).trim();
    if (!sel || /[\x00-\x1f]/.test(sel)) return;
    try {
      if (!document.querySelector(sel)) return;
    } catch (e) {
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "addCustomRule", rule: "##" + sel });
    } catch (e) {}
  });
})();
