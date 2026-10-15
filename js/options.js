async function getSettings() {
  const res = await chrome.runtime.sendMessage({ type: "getSettings" });
  if (!res || res.ok === false) throw new Error((res && res.error) || "no response");
  return res.settings;
}

function ruleToDisplay(rule) {
  const at = rule.indexOf("##");
  if (at > 0) {
    const prefix = rule.slice(0, at).trim();
    const sel = rule.slice(at + 2).trim();
    if (prefix && !prefix.includes("#") && sel) return prefix + " | " + sel;
  }
  return rule;
}

function toText(arr) {
  return (arr || []).map(ruleToDisplay).join("\n");
}

function lineToRule(x) {
  const m = /^([^|]+?)\s*\|\s*(\S.*)$/.exec(x);
  if (m) {
    const left = m[1].trim();
    const right = m[2].trim();
    if (left && !/\s/.test(left) && !left.startsWith("#") && !right.startsWith("##")) {
      return left + "##" + right;
    }
  }
  return x;
}

function fromRuleText(t) {
  return t
    .split(/\n+/)
    .map((x) => lineToRule(x.trim()))
    .filter((x) => {
      if (!x || x.startsWith("!")) return false;
      if (x.startsWith("#") && !x.startsWith("##") && !x.startsWith("#@#") && !x.startsWith("#?#")) return false;
      return true;
    });
}

function fromDomainText(t) {
  return t
    .split(/\n+/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#") && !x.startsWith("!"));
}

const RULE_MAX = 4096;
let lastRuleErrors = 0;

function cssSelectorValid(sel) {
  if (!sel) return false;
  try {
    document.querySelector(sel);
    return true;
  } catch (e) {
    return false;
  }
}

function domainValid(d) {
  if (!d || d.length > 253) return false;
  if (d === "localhost" || d === "local" || d === "intranet") return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(d);
}

// Mirrors the subset the engine (js/background.js + js/state.js) actually
// accepts, so the editor can flag a rule that would be silently dropped.
function validateRule(rule) {
  const line = (rule || "").trim();
  if (!line) return null;
  if (line.charAt(0) === "!" || line.charAt(0) === "[") return { level: "muted", message: "comment / metadata (ignored)" };
  if (line.charAt(0) === "#" && line.indexOf("##") !== 0 && line.indexOf("#@#") !== 0 && line.indexOf("#?#") !== 0) {
    return { level: "muted", message: "comment (ignored)" };
  }
  if (line.length > RULE_MAX) return { level: "err", message: "line too long (max " + RULE_MAX + ")" };
  if (/[^\x20-\x7e]/.test(line)) return { level: "err", message: "non-ASCII characters are not allowed" };
  const ci = line.indexOf("##");
  if (ci !== -1) {
    const prefix = line.slice(0, ci).trim();
    const sel = line.slice(ci + 2).trim();
    if (!sel) return { level: "err", message: "cosmetic rule has an empty selector" };
    if (prefix) {
      const parts = prefix.split(",");
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i].trim().replace(/^~/, "");
        if (p && !domainValid(p)) return { level: "err", message: "invalid domain prefix: " + parts[i].trim() };
      }
    }
    if (!cssSelectorValid(sel)) return { level: "err", message: "invalid CSS selector" };
    return { level: "ok", message: "cosmetic hide" };
  }
  if (line.indexOf("#@#") !== -1 || line.indexOf("#?#") !== -1) return { level: "warn", message: "exception rule not supported by the engine" };
  if (line.indexOf("$") !== -1) return { level: "warn", message: "network modifiers ($...) are ignored" };
  if (line.length > 2 && line.charAt(0) === "/" && line.charAt(line.length - 1) === "/") {
    const inner = line.slice(1, -1);
    if (!inner || inner.length > 1000) return { level: "err", message: "regex body is empty or too long" };
    try {
      new RegExp(inner);
    } catch (e) {
      return { level: "err", message: "invalid regex: " + e.message };
    }
    return { level: "ok", message: "regex block" };
  }
  const bare = /^\|\|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\/?$/i.exec(line);
  const wild = /^\|\|\*\.([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\/?$/i.exec(line);
  if (bare || wild) {
    const host = (bare || wild)[1];
    return domainValid(host) ? { level: "ok", message: "domain block" } : { level: "err", message: "invalid host: " + host };
  }
  if (line.indexOf("||*") === 0) return { level: "err", message: "unsupported wildcard domain" };
  if (/^[|*^]+$/.test(line)) return { level: "err", message: "rule has no pattern" };
  return { level: "ok", message: "pattern block" };
}

function renderRuleStatus() {
  const box = document.getElementById("ruleStatus");
  if (!box) return;
  const lines = document.getElementById("rules").value.split(/\n/);
  let okCount = 0;
  let warnCount = 0;
  let errCount = 0;
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const v = validateRule(lineToRule(raw));
    if (!v) continue;
    if (v.level === "err") {
      errCount++;
      issues.push({ line: i + 1, level: "err", text: raw, message: v.message });
    } else if (v.level === "warn") {
      warnCount++;
      issues.push({ line: i + 1, level: "warn", text: raw, message: v.message });
    } else if (v.level === "ok") {
      okCount++;
    }
  }
  box.textContent = "";
  const summary = document.createElement("div");
  summary.className = "status-summary";
  lastRuleErrors = errCount;
  if (okCount + warnCount + errCount === 0) {
    summary.textContent = "No active rules.";
  } else {
    const o = document.createElement("span");
    o.className = "ok";
    o.textContent = okCount + " valid";
    summary.appendChild(o);
    if (warnCount) {
      const w = document.createElement("span");
      w.className = "warn";
      w.textContent = warnCount + " warning" + (warnCount > 1 ? "s" : "");
      summary.appendChild(w);
    }
    if (errCount) {
      const e = document.createElement("span");
      e.className = "err";
      e.textContent = errCount + " error" + (errCount > 1 ? "s" : "");
      summary.appendChild(e);
    }
  }
  box.appendChild(summary);
  for (let i = 0; i < issues.length && i < 50; i++) {
    const it = issues[i];
    const row = document.createElement("div");
    row.className = "status-item " + it.level;
    row.textContent = "Line " + it.line + ": " + it.message + " — " + it.text.slice(0, 80);
    box.appendChild(row);
  }
}

async function refreshForm() {
  let s;
  try {
    s = await getSettings();
  } catch (e) {
    s = { enabled: true, whitelist: [], customRules: [] };
  }
  document.getElementById("rules").value = toText(s.customRules);
  document.getElementById("whitelist").value = toText(s.whitelist);
  renderRuleStatus();

  const re = document.getElementById("remoteEnabled");
  if (re) re.checked = s.remoteListEnabled === true;
  const ru = document.getElementById("remoteUrl");
  if (ru) ru.value = s.remoteListUrl || "";
  try {
    const st = await chrome.runtime.sendMessage({ type: "getRemoteListStatus" });
    if (st && st.ok) {
      const count = (st.remote && st.remote.count) || 0;
      renderRemoteStatus({ ok: true, status: count ? "cached" : "empty", count: count }, st.settings || s);
    } else {
      renderRemoteStatus(null, s);
    }
  } catch (e) {
    renderRemoteStatus(null, s);
  }
}

function renderRemoteStatus(remote, settings) {
  const el = document.getElementById("remoteStatus");
  if (!el) return;
  const s = settings || {};
  if (s.remoteListEnabled !== true) {
    el.textContent = "Remote list is off.";
    el.className = "status-text";
    return;
  }
  if (!s.remoteListUrl) {
    el.textContent = "No list URL configured.";
    el.className = "status-text";
    return;
  }
  if (remote && remote.ok === false) {
    el.textContent = "Sync failed: " + (remote.error || "unknown");
    el.className = "status-text err";
    return;
  }
  const count = remote && typeof remote.count === "number" ? remote.count : 0;
  const status = remote && remote.status ? remote.status : "cached";
  el.textContent = status + " — " + count + " rule(s) active";
  el.className = "status-text ok";
}

async function applyRemoteList(enabled, url) {
  const el = document.getElementById("remoteStatus");
  if (el) {
    el.textContent = "Syncing…";
    el.className = "status-text";
  }
  let resp = null;
  try {
    resp = await chrome.runtime.sendMessage({ type: "setRemoteList", enabled: enabled, url: url });
  } catch (e) {}
  if (resp && resp.ok) renderRemoteStatus(resp.remote || null, resp.settings || {});
  else renderRemoteStatus({ ok: false, error: (resp && resp.error) || "failed" }, { remoteListEnabled: enabled, remoteListUrl: url });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (window.__unblockI18n) window.__unblockI18n.applyStaticI18n();
  } catch (e) {}
  await refreshForm();

  document.getElementById("refresh").addEventListener("click", refreshForm);

  document.getElementById("rules").addEventListener("input", renderRuleStatus);

  const remoteEnabled = document.getElementById("remoteEnabled");
  const remoteUrl = document.getElementById("remoteUrl");
  if (remoteEnabled) {
    remoteEnabled.addEventListener("change", () => {
      applyRemoteList(remoteEnabled.checked, remoteUrl ? remoteUrl.value.trim() : "");
    });
  }
  if (remoteUrl) {
    remoteUrl.addEventListener("change", () => {
      if (remoteEnabled && remoteEnabled.checked) applyRemoteList(true, remoteUrl.value.trim());
    });
  }
  const remoteSync = document.getElementById("remoteSync");
  if (remoteSync) {
    remoteSync.addEventListener("click", async () => {
      const el = document.getElementById("remoteStatus");
      if (el) {
        el.textContent = "Syncing…";
        el.className = "status-text";
      }
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({ type: "syncRemoteList" });
      } catch (e) {}
      if (resp && resp.ok) renderRemoteStatus(resp.remote || null, resp.settings || {});
      else renderRemoteStatus({ ok: false, error: (resp && resp.error) || "failed" }, { remoteListEnabled: true, remoteListUrl: remoteUrl ? remoteUrl.value.trim() : "" });
    });
  }

  document.getElementById("save").addEventListener("click", async () => {
    const customRules = fromRuleText(document.getElementById("rules").value);
    const whitelist = fromDomainText(document.getElementById("whitelist").value);
    if (lastRuleErrors > 0 && !confirm(lastRuleErrors + " rule(s) are invalid and will be ignored. Save anyway?")) return;
    const r1 = await chrome.runtime.sendMessage({ type: "saveCustomRules", rules: customRules });
    const r2 = await chrome.runtime.sendMessage({ type: "setWhitelist", domains: whitelist });
    alert(r1 && r1.ok && r2 && r2.ok ? "Saved" : "Save failed");
  });

  document.getElementById("export").addEventListener("click", () => {
    const ns = {
      customRules: fromRuleText(document.getElementById("rules").value),
      whitelist: fromDomainText(document.getElementById("whitelist").value),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(ns, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "unblock-custom-rules.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("import").click();
  });

  document.getElementById("import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const txt = await file.text();
    try {
      const obj = JSON.parse(txt);
      if (Array.isArray(obj.customRules)) document.getElementById("rules").value = toText(obj.customRules);
      if (Array.isArray(obj.whitelist)) document.getElementById("whitelist").value = toText(obj.whitelist);
      renderRuleStatus();
      alert("Imported. Click Save to apply.");
    } catch (err) {
      document.getElementById("rules").value = txt;
      renderRuleStatus();
    }
    e.target.value = "";
  });
});
