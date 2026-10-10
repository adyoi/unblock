async function getSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "getSettings" });
    return res && res.settings ? res.settings : {};
  } catch (e) {
    return {};
  }
}

async function toggle(v) {
  await chrome.runtime.sendMessage({ type: "toggle", enabled: v });
}

async function currentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return "";
    return new URL(tab.url).hostname;
  } catch (e) {
    return "";
  }
}

async function render() {
  const settings = await getSettings();
  const host = await currentHost();
  const wl = settings.whitelist || [];

  const chk = document.getElementById("toggle");
  const status = document.getElementById("status");
  if (chk) chk.checked = !!settings.enabled;
  // Mirror the state onto the wrapper too: the slider colour must not depend
  // solely on `:checked` + an overlaying invisible input.
  const sw = document.querySelector(".switch");
  if (sw) sw.classList.toggle("on", !!settings.enabled);

  const isAllowed = !!host && wl.indexOf(host) !== -1;

  if (status) {
    if (isAllowed) {
      status.textContent = "Paused on this site";
      status.classList.remove("on", "off");
      status.classList.add("warn");
    } else {
      status.textContent = settings.enabled ? "Blocking ON" : "Blocking OFF";
      status.classList.remove("warn");
      status.classList.toggle("on", !!settings.enabled);
      status.classList.toggle("off", !settings.enabled);
    }
  }

  // The whitelist applies allowAllRequests to the whole domain, so it has to
  // look like a reversible state. Previously this button only ever added an
  // entry, which left sites silently unblocked with no way back from the popup.
  const allowBtn = document.getElementById("blockThis");
  if (allowBtn) {
    allowBtn.disabled = !host;
    allowBtn.classList.toggle("warn", isAllowed);
    allowBtn.textContent = !host
      ? "Unavailable"
      : isAllowed
        ? "Unblock this site"
        : "Whitelist site";
  }

  const list = document.getElementById("whitelist");
  if (list) {
    list.textContent = "";
    for (let i = 0; i < wl.length; i++) {
      const d = wl[i];
      const div = document.createElement("div");
      div.className = d === host ? "item current" : "item";
      const span = document.createElement("span");
      span.textContent = d;
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "Remove";
      btn.dataset.rm = d;
      div.appendChild(span);
      div.appendChild(btn);
      list.appendChild(div);
    }
  }

  const clearBtn = document.getElementById("clearWl");
  if (clearBtn) {
    clearBtn.hidden = wl.length === 0;
    clearBtn.textContent = wl.length ? "Clear all (" + wl.length + ")" : "Clear all";
  }

  // Empty-state copy lives here rather than only in the markup, so it survives
  // any future re-render even if the static HTML is trimmed.
  const empty = document.getElementById("wlEmpty");
  if (empty) {
    empty.textContent = "Empty";
    empty.hidden = wl.length !== 0;
  }

  const adv = document.getElementById("advanced");
  if (adv) adv.checked = settings.advancedDefenses !== false;
  const heur = document.getElementById("heuristics");
  if (heur) heur.checked = settings.heuristicsEnabled !== false;
  const sl = document.getElementById("scriptletsAllow");
  if (sl) {
    sl.checked = !!host && (settings.scriptletsAllowlist || []).indexOf(host) !== -1;
    sl.disabled = !host;
  }
}

// Listeners are bound before the first render: a single rejected await used to
// abort this whole handler, which left every control (including the master
// toggle) dead while the popup still looked normal.
function bind() {
  const t = document.getElementById("toggle");
  if (t) {
    t.addEventListener("change", async (e) => {
      try { await toggle(e.target.checked); } catch (err) {}
      try { await render(); } catch (err) {}
    });
  }

  const opt = document.getElementById("options");
  if (opt) opt.addEventListener("click", () => { chrome.runtime.openOptionsPage(); });

  const bt = document.getElementById("blockThis");
  if (bt) {
    bt.addEventListener("click", async () => {
      try {
        const host = await currentHost();
        if (!host) return;
        const settings = await getSettings();
        const wl = settings.whitelist || [];
        if (wl.indexOf(host) !== -1) {
          await chrome.runtime.sendMessage({ type: "removeWhitelist", domain: host });
        } else {
          await chrome.runtime.sendMessage({ type: "addWhitelist", domain: host });
        }
        await render();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          try { await chrome.tabs.reload(tab.id); } catch (e) {}
        }
        window.close();
      } catch (err) {}
    });
  }

  const rl = document.getElementById("reload");
  if (rl) {
    rl.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        try { await chrome.tabs.reload(tab.id); } catch (e) {}
      }
      window.close();
    });
  }

  const pickerBtn = document.getElementById("picker");
  if (pickerBtn) {
    pickerBtn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      try {
        await chrome.runtime.sendMessage({ type: "startPicker", tabId: tab.id });
      } catch (e) {}
      window.close();
    });
  }

  const wl = document.getElementById("whitelist");
  if (wl) {
    wl.addEventListener("click", async (e) => {
      const rm = e.target && e.target.dataset ? e.target.dataset.rm : null;
      if (!rm) return;
      await chrome.runtime.sendMessage({ type: "removeWhitelist", domain: rm });
      await render();
    });
  }

  const clearWl = document.getElementById("clearWl");
  if (clearWl) {
    clearWl.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "clearWhitelist" });
      await render();
    });
  }

  const adv = document.getElementById("advanced");
  if (adv) adv.addEventListener("change", async (e) => { await chrome.runtime.sendMessage({ type: "setAdvancedDefenses", enabled: e.target.checked }); });
  const heur = document.getElementById("heuristics");
  if (heur) heur.addEventListener("change", async (e) => { await chrome.runtime.sendMessage({ type: "setHeuristics", enabled: e.target.checked }); });
  const sl = document.getElementById("scriptletsAllow");
  if (sl) {
    sl.addEventListener("change", async (e) => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const h = tab && tab.url ? new URL(tab.url).hostname : "";
        if (h) await chrome.runtime.sendMessage({ type: "toggleScriptletsAllowlist", domain: h });
      } catch (ee) {}
    });
  }
}

bind();

render().catch(() => {});
