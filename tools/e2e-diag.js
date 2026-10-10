//
// Diagnostic: launches Chrome with the unpacked extension, evaluates probes in
// the eval page AND in chrome://extensions, and reports what the page context
// actually looks like. Uses Node's built-in WebSocket client (Node >= 21).
//
// Run: node tools/e2e-diag.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTTP_PORT = 41893;
const CDP_PORT = 41894;
const PROFILE = path.join(os.tmpdir(), "opencode", "unblock-diag");

const http = require("http");
const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("content-type", "text/html");
    res.end("<title>diag</title><script>window.__PAGE_READY__=1</script>diag page");
  } else {
    res.statusCode = 404;
    res.end("nf");
  }
});

function wsSend(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const to = setTimeout(() => reject(new Error("timeout " + method)), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params: params || {} }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(to);
        ws.close();
        resolve(msg);
      }
    };
    ws.onerror = (e) => {
      clearTimeout(to);
      reject(e);
    };
  });
}

async function evalIn(target, expr, returnByValue) {
  const r = await wsSend(target.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: expr,
    returnByValue: returnByValue === false ? false : true,
    awaitPromise: true
  });
  return r.result && r.result.result && r.result.result.value;
}

async function getTargets() {
  const r = await fetch("http://127.0.0.1:" + CDP_PORT + "/json/list");
  return r.json();
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  await new Promise((r) => server.listen(HTTP_PORT, "127.0.0.1", r));

  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=" + CDP_PORT,
      "--user-data-dir=" + PROFILE,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--enable-logging=stderr",
      "--enable-unsafe-extension-debugging",
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
    if (stderrBuf.length > 200000) stderrBuf = stderrBuf.slice(-200000);
  });

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version");
      if (r.ok) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 2500));

  console.log("---- load unpacked via CDP Extensions domain ----");
  try {
    const ver = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version")).json();
    const res = await wsSend(ver.webSocketDebuggerUrl, "Extensions.loadUnpacked", {
      path: ROOT.replace(/\\/g, "/"),
      options: { failOnLoadError: true }
    });
    console.log("Extensions.loadUnpacked -> " + JSON.stringify(res, null, 1).slice(0, 500));
  } catch (e) {
    console.log("Extensions.loadUnpacked failed: " + e.message);
  }
  await new Promise((r) => setTimeout(r, 2500));

  console.log("---- targets ----");
  for (const t of await getTargets()) {
    console.log(t.type + " " + (t.url || "").slice(0, 100));
  }

  const nt = await fetch("http://127.0.0.1:" + CDP_PORT + "/json/new?" + encodeURIComponent("http://127.0.0.1:" + HTTP_PORT + "/"), { method: "PUT" });
  console.log("json/new -> " + JSON.stringify(await nt.json()));
  await new Promise((r) => setTimeout(r, 2000));

  const targets = await getTargets();
  const page = targets.find((t) => t.type === "page" && (t.url || "").indexOf("127.0.0.1:" + HTTP_PORT) === 0);
  const extPage = targets.find((t) => t.type === "page" && (t.url || "").indexOf("chrome://extensions") === 0);

  if (page) {
    console.log("---- eval page probes ----");
    console.log("guard marker   = " + JSON.stringify(await evalIn(page, "window.__unblockGuardInstalled__")));
    console.log("typeof Window  = " + JSON.stringify(await evalIn(page, "typeof Window")));
    console.log("typeof Window.prototype.open = " + JSON.stringify(await evalIn(page, "typeof Window.prototype.open")));
    console.log("typeof window.open = " + JSON.stringify(await evalIn(page, "typeof window.open")));
    console.log("window.open === Window.prototype.open = " + JSON.stringify(await evalIn(page, "String(window.open === Window.prototype.open)")));

    const openR = await evalIn(page, "(function(){ try { var r = window.open('/leak?x=1','_blank'); return r === null ? 'null' : (r && r.closed === false ? 'OPENED' : 'other'); } catch(e){ return 'err:'+e.message; } })()");
    console.log("window.open('/leak?x=1') -> " + JSON.stringify(openR));

    const protoR = await evalIn(page, "(function(){ try { var r = Window.prototype.open.call(window,'/leak?x=2','_blank'); return r === null ? 'null' : (r && r.closed === false ? 'OPENED' : 'other'); } catch(e){ return 'err:'+e.message; } })()");
    console.log("Window.prototype.open.call -> " + JSON.stringify(protoR));

    const ownDesc = await evalIn(page, "JSON.stringify(Object.getOwnPropertyDescriptor(window,'open'))");
    console.log("own descriptor window.open = " + JSON.stringify(ownDesc));
  }

  if (extPage) {
    console.log("---- chrome://extensions ----");
    const txt = await evalIn(extPage, "document.body ? document.body.innerText.slice(0,2000) : 'nobody'");
    console.log(txt);
  } else {
const t = await fetch("http://127.0.0.1:" + CDP_PORT + "/json/new?" + encodeURIComponent("chrome://extensions"), { method: "PUT" });
  const j = await t.json();
  await new Promise((r) => setTimeout(r, 2500));
  const targets2 = await getTargets();
  const extPage2 = targets2.find((x) => x.type === "page" && (x.url || "").indexOf("chrome://extensions") === 0);
  if (extPage2) {
    console.log("---- chrome://extensions ----");
    const txt = await evalIn(extPage2, "(function(){ function walk(el){ if(!el) return ''; if(el.shadowRoot) return Array.from(el.shadowRoot.querySelectorAll('*')).map(n=>walk(n)).join('\\n') || el.shadowRoot.textContent || ''; return (el.innerText||''); } return document.body ? walk(document.body) : 'nobody'; })()");
    console.log(txt.slice(0, 3000));
  }

  console.log("---- stderr (extension/renderer lines) ----");
  const errLines = stderrBuf.split("\n").filter((l) =>
    /extension|unpacked|host_permissions|declarativeNetRequest|load/i.test(l)
  );
  console.log((errLines.slice(-40).join("\n") || "(no matching stderr lines)"));
  }

  try {
    const log = path.join(PROFILE, "chrome_debug.log");
    if (fs.existsSync(log)) {
      console.log("---- chrome_debug.log ----");
      console.log(fs.readFileSync(log, "utf8").slice(0, 3000));
    }
  } catch (e) {}

  try {
    execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" });
  } catch (e) {}
  server.close();
}

main();