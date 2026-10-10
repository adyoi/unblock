(() => {
  const OWNER_ADV = "adv";
  const OWNER_CUSTOM = "adv-custom";
  const GENERIC = [
    '[id^="ad-"]',
    '[id^="ads-"]',
    '[id^="advert"]',
    '[class^="ad-"]',
    '[class^="ads-"]',
    '[class^="advert"]',
    'div[id^="taboola-"]',
    'div[id^="outbrain-"]',
    'iframe[src*="googlesyndication" i]',
    'iframe[src*="doubleclick" i]',
    'iframe[src*="adnxs" i]',
    'ins.adsbygoogle',
    '.adsbygoogle',
    '[data-google-query-id]',
    '[class^="sponsored"]',
    '[class$="sponsored"]',
    '[id^="sponsored"]',
    '[title="Sponsored"]',
    '[title="Advertisement"]',
    '[aria-label="Sponsored"]',
    '[aria-label="Advertisement"]',
    '[data-ad][data-ad-unit]',
    'a[href*="adclick" i]',
    'a[href*="utm_source=ad" i]'
  ];
  const procedural = [];
  let snap = null;
  let prevKey = null;
  let scheduled = false;

  function restoreEl(el) {
    const prev = el.getAttribute("data-unblock-orig") || "";
    const prio = el.getAttribute("data-unblock-orig-prio") || "";
    if (prev) el.style.setProperty("display", prev, prio);
    else el.style.removeProperty("display");
    el.removeAttribute("data-unblock-orig");
    el.removeAttribute("data-unblock-orig-prio");
    el.removeAttribute("data-unblock-hidden");
  }

  function hideOwned(el, owner) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === "VIDEO" || el.tagName === "AUDIO" || el.tagName === "SOURCE" || el.tagName === "TRACK") return;
    try {
      if (el.hasAttribute("controls")) return;
      if (el.closest("video,audio")) return;
    } catch (e) {
      return;
    }
    if (el.getAttribute("data-unblock-hidden")) return;
    try {
      const prev = el.style.getPropertyValue("display");
      const prio = el.style.getPropertyPriority("display");
      el.setAttribute("data-unblock-orig", prev);
      el.setAttribute("data-unblock-orig-prio", prio);
      el.setAttribute("data-unblock-hidden", owner);
      el.style.setProperty("display", "none", "important");
    } catch (e) {}
  }

  function restoreOwned(owner) {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[data-unblock-hidden="' + owner + '"]');
    } catch (e) {
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      restoreEl(nodes[i]);
    }
  }

  function applySet(list, owner) {
    for (let i = 0; i < list.length; i++) {
      try {
        const nodes = document.querySelectorAll(list[i]);
        for (let j = 0; j < nodes.length; j++) hideOwned(nodes[j], owner);
      } catch (e) {}
    }
  }

  function stateFlags() {
    if (!snap) return null;
    return {
      active: !!snap.active,
      adv: !!snap.active && !!snap.advanced,
      custom: !!snap.active && Array.isArray(snap.customSelectors) && snap.customSelectors.length > 0
    };
  }

  function applyAll() {
    const flags = stateFlags();
    if (!flags) return;
    if (flags.custom) applySet(snap.customSelectors, OWNER_CUSTOM);
    if (flags.adv) {
      applySet(procedural, OWNER_ADV);
      applySet(GENERIC, OWNER_ADV);
    }
  }

  function syncState(next) {
    snap = next;
    const flags = stateFlags();
    if (!flags) return;
    const key =
      (flags.active ? "a" : "") +
      (flags.adv ? "v" : "") +
      (flags.custom ? "c" : "") +
      "|" +
      (flags.custom ? snap.customSelectors.join("\n") : "");
    if (key !== prevKey) {
      restoreOwned(OWNER_ADV);
      restoreOwned(OWNER_CUSTOM);
      prevKey = key;
    }
    applyAll();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyAll();
    });
  }

  const mo = new MutationObserver(scheduleApply);

  function startObserver() {
    if (document.documentElement) {
      mo.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  if (window.__uboState && window.__uboState.subscribe) {
    window.__uboState.subscribe(syncState);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        applyAll();
        startObserver();
      },
      { once: true }
    );
  } else {
    applyAll();
    startObserver();
  }

  setTimeout(applyAll, 800);
  setTimeout(applyAll, 1500);
  setTimeout(applyAll, 2500);

  window.__uboCosmetic = {
    addSelectors: (arr) => {
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s && procedural.indexOf(s) === -1) {
          procedural.push(s);
        }
      }
      applyAll();
    }
  };
})();
