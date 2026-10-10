const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = path.join(os.tmpdir(), "opencode", "unblock-dnr");

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
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("timeout " + method)); }, timeout || 20000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params: params || {} }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) { clearTimeout(to); ws.close(); resolve(msg); }
    };
    ws.onerror = (e) => { clearTimeout(to); reject(e); };
  });
}

async function wsEvaluate(wsUrl, expression) {
  const r = await wsCall(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result && r.result.result && r.result.result.value;
}

async function main() {
  const mode = process.env.MODE || "rule"; // "rule" | "control"
  try {
    execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'unblock-dnr\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { stdio: "ignore" }
    );
  } catch (e) {}
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const aPort = await freePort();
  const bPort = await freePort();
  const cdpPort = await freePort();
  let pixelHits = 0;
  let landHits = [];

  const serverB = http.createServer((req, res) => {
    if (req.url === "/pixel.png") { pixelHits++; res.end("x"); }
    else if (req.url.startsWith("/land")) { landHits.push(req.url); res.end("landed"); }
    else res.end("b");
  });
  await new Promise((r) => serverB.listen(bPort, "127.0.0.1", r));

  const srcPage = 'http://127.0.0.1:' + aPort + '/page.html';
  const serverA = http.createServer((req, res) => {
    if (req.url === "/page.html") {
      res.setHeader("content-type", "text/html");
      res.end(
        "<title>dnr page</title>" +
        '<img id="px" src="http://127.0.0.1:' + bPort + '/pixel.png">' +
        '<a id="lnk" href="http://127.0.0.1:' + bPort + '/land?link=1">link</a>' +
        '<button id="btn">nav</button>' +
        '<script>document.getElementById("btn").onclick=function(){window.location.href="http://127.0.0.1:' + bPort + '/land?script=1";};' +
        "setTimeout(function(){window.location.assign('http://127.0.0.1:" + bPort + "/land?assign=1');},400);" +
        "</script>"
      );
    } else res.end("a");
  });
  await new Promise((r) => serverA.listen(aPort, "127.0.0.1", r));

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

  for (let i = 0; i < 80; i++) {
    try { const r = await fetch("http://127.0.0.1:" + cdpPort + "/json/version"); if (r.ok) break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const ver = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/version")).json();

  let guardReady = false;
  for (let i = 0; i < 6 && !guardReady; i++) {
    try {
      await wsCall(ver.webSocketDebuggerUrl, "Extensions.loadUnpacked", {
        path: ROOT.replace(/\\/g, "/"),
        options: { failOnLoadError: true }
      });
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const list = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/list")).json();
      const sw = list.find((t) => t.type === "service_worker" && /js\/background\.js$/.test(t.url || ""));
      if (sw) {
        const ids = await wsEvaluate(sw.webSocketDebuggerUrl,
          "chrome.scripting.getRegisteredContentScripts().then(a=>a.map(s=>s.id))");
        guardReady = Array.isArray(ids) && ids.indexOf("unblock-main-guard") !== -1;
      }
    } catch (e) {}
    if (!guardReady) {
      try { await fetch("http://127.0.0.1:" + cdpPort + "/json/new?about%3Ablank", { method: "PUT" }); } catch (e) {}
    }
  }
  console.log("dnr-test: guard=" + guardReady);

  if (mode === "rule") {
    try {
      const list = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/list")).json();
      const sw = list.find((t) => t.type === "service_worker" && /js\/background\.js$/.test(t.url || ""));
      const exp = await wsEvaluate(sw.webSocketDebuggerUrl,
        "chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:9100,priority:9,action:{type:'block'},condition:{urlFilter:'127.0.0.1:" + bPort + "/'}}]}).then(()=>'ok').catch(e=>'ERR '+e)");
      console.log("dnr-test: session rule add = " + exp + " (blocks B=127.0.0.1:" + bPort + ")");
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) { console.log("dnr-test: rule add failed " + e.message); }
  } else {
    console.log("dnr-test: MODE=control (no rule)");
  }

  const tab = await (await fetch(
    "http://127.0.0.1:" + cdpPort + "/json/new?" + encodeURIComponent(srcPage),
    { method: "PUT" }
  )).json();
  const ws = tab.webSocketDebuggerUrl;
  await new Promise((r) => setTimeout(r, 2500));
  console.log("after auto-load 2500ms -> pixelHits=" + pixelHits + " landHits=" + JSON.stringify(landHits) + " url=" + ((await wsEvaluate(ws, "location.href")) || "").slice(0, 90));

  let btnRect = null;
  try {
    btnRect = await wsEvaluate(ws, "JSON.stringify((function(){var b=document.getElementById('btn');if(!b)return null;var r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})())");
  } catch (e) {}
  if (btnRect) {
    const { x, y } = JSON.parse(btnRect);
    await wsCall(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await wsCall(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    console.log("dnr-test: trusted click on #btn (location.href -> B/land?script=1)");
    await new Promise((r) => setTimeout(r, 1800));
    console.log("after script-nav 1800ms -> landHits=" + JSON.stringify(landHits) + " url=" + ((await wsEvaluate(ws, "location.href")) || "").slice(0, 90));
  }

  let lnkRect = null;
  try {
    lnkRect = await wsEvaluate(ws, "JSON.stringify((function(){var b=document.getElementById('lnk');if(!b)return null;var r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})())");
  } catch (e) {}
  if (lnkRect) {
    const { x, y } = JSON.parse(lnkRect);
    await wsCall(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await wsCall(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    console.log("dnr-test: trusted click on #lnk (real <a> -> B/land?link=1)");
    await new Promise((r) => setTimeout(r, 1500));
    console.log("after link-nav 1500ms -> landHits=" + JSON.stringify(landHits) + " url=" + ((await wsEvaluate(ws, "location.href")) || "").slice(0, 90));
  }

  console.log("dnr-test " + mode + ": pixelHits=" + pixelHits + " (0 => DNR blocked subresource image)");
  console.log("dnr-test " + mode + ": landHits=" + JSON.stringify(landHits) + " land=" + landHits.length);

  try { execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" }); } catch (e) {}
  serverA.close();
  serverB.close();
  process.exit(0);
}

main();