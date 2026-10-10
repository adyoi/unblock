const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = path.join(os.tmpdir(), "opencode", "unblock-shot");
const OUT = path.join(ROOT, "store");
const W = 1280;
const H = 800;

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function wsCall(wsUrl, method, params, timeout) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("timeout " + method)); }, timeout || 25000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params: params || {} }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(to);
        ws.close();
        resolve(msg.result);
      }
    };
    ws.onerror = (e) => { clearTimeout(to); reject(e); };
  });
}

async function extId(cdpPort) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/list")).json();
      const sw = list.find((t) => t.type === "service_worker" && /\/js\/background\.js$/.test(t.url || ""));
      const m = sw && /^chrome-extension:\/\/([^/]+)\//.exec(sw.url);
      if (m) return m[1];
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return ws;
}

async function shot(cdpPort, pageUrl) {
  const tab = await (await fetch(
    "http://127.0.0.1:" + cdpPort + "/json/new?" + encodeURIComponent("about:blank"),
    { method: "PUT" }
  )).json();
  const ws = await connect(tab.webSocketDebuggerUrl);
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const to = setTimeout(() => reject(new Error("timeout " + method)), 25000);
    const onmsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { clearTimeout(to); ws.removeEventListener("message", onmsg); resolve(m.result); }
    };
    ws.addEventListener("message", onmsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evt = (method) => new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("timeout ev " + method)), 30000);
    const onmsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === method) { clearTimeout(to); ws.removeEventListener("message", onmsg); resolve(); }
    };
    ws.addEventListener("message", onmsg);
  });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = evt("Page.loadEventFired");
  await call("Page.navigate", { url: pageUrl });
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))]);
  await new Promise((r) => setTimeout(r, 900));
  return { ws, call };
}

async function main() {
  try {
    execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'unblock-shot\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { stdio: "ignore" }
    );
  } catch (e) {}
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const cdpPort = await freePort();
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=" + cdpPort,
      "--user-data-dir=" + PROFILE,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-extension-debugging",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + cdpPort + "/json/version");
      if (r.ok) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const ver = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/version")).json();

  let id = null;
  for (let i = 0; i < 8 && !id; i++) {
    try {
      await wsCall(ver.webSocketDebuggerUrl, "Extensions.loadUnpacked", {
        path: ROOT.replace(/\\/g, "/"),
        options: { failOnLoadError: true }
      });
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 800));
    id = await extId(cdpPort);
  }
  if (!id) { console.log("shot: extension id not found"); process.exit(1); }
  const base = "chrome-extension://" + id;
  console.log("shot: ext id = " + id);

  // popup ------------------------------------------------------------------
  const p = await shot(cdpPort, base + "/ui/popup.html");
  await p.call("Runtime.evaluate", {
    expression: "document.head.insertAdjacentHTML('beforeend','<style>@media screen{body{width:auto!important;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:48px 24px 24px;background:linear-gradient(180deg,#1d232c 0%,#12161c 100%) fixed!important}.popup{box-shadow:0 14px 44px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden}}</style>');'loaded'",
    returnByValue: true
  });
  await new Promise((r) => setTimeout(r, 500));
  const spr = await p.call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "screenshot-1.png"), Buffer.from(spr.data, "base64"));
  console.log("shot: screenshot-1.png (popup)");
  p.ws.close();

  // options ---------------------------------------------------------------
  const o = await shot(cdpPort, base + "/ui/options.html");
  const sr = await o.call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "screenshot-2.png"), Buffer.from(sr.data, "base64"));
  console.log("shot: screenshot-2.png (options)");
  o.ws.close();

  try { execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" }); } catch (e) {}
  process.exit(0);
}

main();