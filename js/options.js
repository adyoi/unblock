async function getSettings() {
  const res = await chrome.runtime.sendMessage({ type: "getSettings" });
  if (!res || res.ok === false) throw new Error((res && res.error) || "no response");
  return res.settings;
}

function toText(arr) {
  return (arr || []).join("\n");
}

function fromRuleText(t) {
  return t
    .split(/\n+/)
    .map((x) => x.trim())
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

document.addEventListener("DOMContentLoaded", async () => {
  let s;
  try {
    s = await getSettings();
  } catch (e) {
    s = { enabled: true, whitelist: [], customRules: [] };
  }
  document.getElementById("rules").value = toText(s.customRules);
  document.getElementById("whitelist").value = toText(s.whitelist);

  document.getElementById("save").addEventListener("click", async () => {
    const customRules = fromRuleText(document.getElementById("rules").value);
    const whitelist = fromDomainText(document.getElementById("whitelist").value);
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
      alert("Imported. Click Save to apply.");
    } catch (err) {
      document.getElementById("rules").value = txt;
    }
    e.target.value = "";
  });
});
