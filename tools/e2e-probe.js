//
// Focused probe: distinguishes a trusted real click from an untrusted
// dispatched click on a target=_blank anchor under the loaded guard.
//
// Run: node tools/e2e-probe.js

const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = path.join(os.tmpdir(), "opencode", "unblock-probe");

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function wsCall(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const to = setTimeout(() => reject(new Error("timeout " + method)), 20000);
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

async function wsEvaluate(wsUrl, expression) {
  const r = await wsCall(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result && r.result.result && r.result.result.value;
}

async function waitGuardRegistered(cdpPort) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/list")).json();
      const sw = list.find((t) => t.type === "service_worker" && /js\/background\.js$/.test(t.url || ""));
      if (sw) {
        const ids = await wsEvaluate(
          sw.webSocketDebuggerUrl,
          "chrome.scripting.getRegisteredContentScripts().then(a => a.map(s => s.id))"
        );
        if (Array.isArray(ids) && ids.indexOf("unblock-main-guard") !== -1) return true;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  try {
    execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'unblock-probe\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { stdio: "ignore" }
    );
  } catch (e) {}
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const httpPort = await freePort();
  const cdpPort = await freePort();

  let shouldNotOpenHits = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        "<title>probe</title>" +
          '<a id="leaker" href="/should-not-open" target="_blank" style="position:absolute;left:20px;top:20px;width:40px;height:40px">go</a>' +
          "<script>window.__p=[];window.addEventListener('click',function(e){window.__p.push({t:(e.target&&e.target.tagName)||'',p:e.defaultPrevented,trust:e.isTrusted,type:e.type});},true);window.addEventListener('submit',function(e){window.__p.push({t:(e.target&&e.target.tagName)||'',p:e.defaultPrevented,trust:e.isTrusted,type:e.type});},true);</script>"
      );
    } else if (req.url.startsWith("/should-not-open")) {
      shouldNotOpenHits.push(req.url);
      res.end("no");
    } else {
      res.end("no");
    }
  });
  await new Promise((r) => server.listen(httpPort, "127.0.0.1", r));

  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=" + cdpPort,
      "--user-data-dir=" + PROFILE,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--enable-unsafe-extension-debugging",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + cdpPort + "/json/version");
      if (r.ok) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const ver = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/version")).json();

  let guardReady = false;
  if (process.env.DISABLE_EXTENSION) {
    console.log("probe: extension DISABLED (control)");
    guardReady = true;
  } else {
    for (let i = 0; i < 5 && !guardReady; i++) {
      try {
        await wsCall(ver.webSocketDebuggerUrl, "Extensions.loadUnpacked", {
          path: ROOT.replace(/\\/g, "/"),
          options: { failOnLoadError: true }
        });
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1200));
      guardReady = await waitGuardRegistered(cdpPort);
      if (!guardReady) {
        try {
          await fetch("http://127.0.0.1:" + cdpPort + "/json/new?about%3Ablank", { method: "PUT" });
        } catch (e) {}
      }
    }
  }

  if (!guardReady) {
    console.log("probe: guard never registered");
    process.exit(1);
  }
  console.log("probe: guard registered after polling");

  const tab = await (await fetch(
    "http://127.0.0.1:" + cdpPort + "/json/new?" + encodeURIComponent("http://127.0.0.1:" + httpPort + "/"),
    { method: "PUT" }
  )).json();
  const ws = tab.webSocketDebuggerUrl;
  await new Promise((r) => setTimeout(r, 1500));

  console.log("guard marker in page: " + JSON.stringify(await wsEvaluate(ws, "!!window.__unblockGuardInstalled__")));

  const rect = await wsEvaluate(
    ws,
    "JSON.stringify((function(){var e=document.getElementById('leaker');var r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())"
  );
  const { x, y } = JSON.parse(rect);

  let tm = "";
  if (process.env.DISABLE_EXTENSION) tm = " (CONTROL, no guard)";
  // trusted click via CDP Input
  await wsCall(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: x, y: y, button: "left", clickCount: 1 });
  await wsCall(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: x, y: y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 500));
  console.log("[" + Date.now() % 100000 + "] TRUSTED click" + tm + " -> page saw: " + JSON.stringify(await wsEvaluate(ws, "JSON.stringify(window.__p)") ) + " ; guardTrace=" + JSON.stringify(await wsEvaluate(ws, "JSON.stringify(window.__trace)")) + " ; hits=" + JSON.stringify(shouldNotOpenHits));
  await wsEvaluate(ws, "window.__p=[]; window.__guardClicks=0; window.__trace=[];");

  // untrusted synthetic click
  const synth = await wsEvaluate(
    ws,
    "(function(){ var a=document.getElementById('leaker'); a.dispatchEvent(new MouseEvent('click')); return JSON.stringify(window.__p); })()"
  );
  console.log("[" + Date.now() % 100000 + "] SYNTHETIC click" + tm + " -> page saw: " + synth + " ; guardTrace=" + JSON.stringify(await wsEvaluate(ws, "JSON.stringify(window.__trace)")) + " ; hits=" + JSON.stringify(shouldNotOpenHits));
  await new Promise((r) => setTimeout(r, 700));
  console.log("total /should-not-open hits=" + JSON.stringify(shouldNotOpenHits));

  // isolate vector candidates: form.submit (GET, target=_blank)
  await wsEvaluate(ws, "window.__p=[];(function(){var f=document.createElement('form');f.method='get';f.target='_blank';f.action='/should-not-open?n=7';document.body.appendChild(f);f.submit();})()");
  await new Promise((r) => setTimeout(r, 700));
  console.log("after FORM submit -> hits=" + JSON.stringify(shouldNotOpenHits) + " ; pageSaw=" + JSON.stringify(await wsEvaluate(ws, "JSON.stringify(window.__p)")));

  // isolate: programmatic .click() on a target=_blank anchor
  await wsEvaluate(ws, "(function(){var a=document.createElement('a');a.href='/should-not-open?n=6';a.target='_blank';document.body.appendChild(a);a.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  console.log("after PROGRAMMATIC .click() -> hits=" + JSON.stringify(shouldNotOpenHits));

  // isolate: synthetic auxclick button=1
  await wsEvaluate(ws, "(function(){var a=document.createElement('a');a.href='/should-not-open?n=8';a.target='_blank';document.body.appendChild(a);a.dispatchEvent(new MouseEvent('auxclick',{button:1}));})()");
  await new Promise((r) => setTimeout(r, 700));
  console.log("after SYNTHETIC auxclick(btn=1) -> hits=" + JSON.stringify(shouldNotOpenHits));

  // evaluate whether anchor still has target and page stayed
  const state = await wsEvaluate(ws, "location.href");
  console.log("page href after both: " + state);

  try {
    execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" });
  } catch (e) {}
  server.close();
  process.exit(0);
}

main();