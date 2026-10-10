//
// End-to-end test: runs the unpacked extension in a real Chrome (headless=new,
// falling back to headed) and verifies the MAIN-world popup guard stops every
// known new-tab vector on a controlled page. Chrome's own popup blocker is
// disabled so a guard failure always shows up as a real new tab hitting the
// eval server.
//
// The extension is loaded through the CDP Extensions.loadUnpacked method
// because a plain Google Chrome refuses --load-extension/--disable-extensions-except.
//
// Run:  node tools/e2e-guard.js
// Needs: Chrome at C:\Program Files\Google\Chrome\Application\chrome.exe
//        Node >= 21 (global WebSocket), PowerShell for cleanup.
//
// Exit 0 = guard holds on every vector, 1 = any vector leaked or no guard.

const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FIXTURE = path.join(__dirname, "e2e-fixtures", "popunder-grid.html");

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function sweepOrphans() {
  try {
    execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'unblock-e2e\' -or $_.CommandLine -match \'unblock-diag\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { stdio: "ignore" }
    );
  } catch (e) {}
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (d) => (buf += d));
    req.on("end", () => resolve(buf));
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

// Each run gets its own HTTP server, Chrome instance, ports and profile so
// runs can never cross-contaminate each other's reports or leak lists.
async function runMode(headless) {
  const httpPort = await freePort();
  const cdpPort = await freePort();
  const profile = path.join(os.tmpdir(), "opencode", "unblock-e2e-" + process.pid + (headless ? "-h" : "-w"));

  let leaks = [];
  let report = null;

  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(fs.readFileSync(FIXTURE));
    } else if (req.url.startsWith("/leak")) {
      leaks.push({ u: req.url, ref: req.headers.referer || "", ua: (req.headers["user-agent"] || "").slice(0, 40), ts: Date.now() });
      res.setHeader("content-type", "text/plain");
      res.end("leak");
    } else if (req.url === "/report" && req.method === "POST") {
      readBody(req).then((body) => {
        try {
          report = JSON.parse(body);
        } catch (e) {
          report = { parseError: body.slice(0, 200) };
        }
        res.setHeader("content-type", "text/plain");
        res.end("ok");
      });
    } else if (req.url === "/result") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ report, leaks }));
    } else {
      res.statusCode = 404;
      res.end("nf");
    }
  });
  await new Promise((r) => server.listen(httpPort, "127.0.0.1", r));

  let stderrBuf = "";
  const child = spawn(
    CHROME,
    [
      headless ? "--headless=new" : "",
      "--remote-debugging-port=" + cdpPort,
      "--user-data-dir=" + profile,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--enable-logging=stderr",
      "--enable-unsafe-extension-debugging",
      "about:blank"
    ].filter(Boolean),
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
    if (stderrBuf.length > 200000) stderrBuf = stderrBuf.slice(-200000);
  });

  let cdpOk = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + cdpPort + "/json/version");
      if (r.ok) {
        cdpOk = true;
        break;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }

  if (cdpOk) {
    try {
      const ver = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/version")).json();
      const res = await wsCall(ver.webSocketDebuggerUrl, "Extensions.loadUnpacked", {
        path: ROOT.replace(/\\/g, "/"),
        options: { failOnLoadError: true }
      });
      if (res.error || !res.result || !res.result.id) cdpOk = false;
    } catch (e) {
      cdpOk = false;
    }
  }
  await new Promise((r) => setTimeout(r, 2500));

  let result = null;
  let guardReady = false;
  if (cdpOk) {
    guardReady = await waitGuardRegistered(cdpPort, 15000);
    if (!guardReady) {
      console.log("    guard never registered by service worker (check stderr)");
    }
  }
  if (cdpOk && guardReady) {
    const tab = await (await fetch(
      "http://127.0.0.1:" + cdpPort + "/json/new?" + encodeURIComponent("http://127.0.0.1:" + httpPort + "/"),
      { method: "PUT" }
    )).json();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch("http://127.0.0.1:" + httpPort + "/result");
        const j = await r.json();
        if (j.report) {
          result = j;
          break;
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  try {
    execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" });
  } catch (e) {}
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (e) {}
  server.close();

  return {
    headless,
    cdpOk,
    report: result ? result.report : null,
    leaks: result ? result.leaks : [],
    stderr: stderrBuf.split("\n").filter((l) => /unblock|guard|extension|script/i.test(l)).slice(-12).join("\n")
  };
}

function beacon(name, ok) {
  console.log((ok ? "  OK  " : "  FAIL") + " " + name);
  return ok;
}

async function evaluate(res) {
  let pass = true;
  const r = res.report || {};
  pass = beacon("guard installed (guard=" + JSON.stringify(r.guard) + ")", r.guard === true) && pass;
  pass = beacon("window.open blocked (got " + String(r.open_direct) + ")", r.open_direct === "blocked") && pass;
  pass = beacon("Window.prototype.open blocked (got " + String(r.open_proto) + ")", r.open_proto === "blocked") && pass;
  pass = beacon("window.open() no-arg blocked (got " + String(r.open_none) + ")", r.open_none === "blocked") && pass;
  pass = beacon("synthetic click on target=_blank blocked (got " + String(r.synth_click) + ")", r.synth_click === "blocked") && pass;
  pass = beacon("plain same-tab click not swallowed (got " + String(r.plain_ok) + ")", r.plain_ok === true) && pass;
  const leaked = res.leaks || [];
  pass = beacon("no /leak tabs reached the server (leaks=" + JSON.stringify(leaked) + ")", leaked.length === 0) && pass;
  if (!pass) {
    const marks = (res.report && res.report.attempts) || [];
    for (const l of leaked) {
      const best = marks.reduce(
        (acc, m) => {
          const mt = parseInt(m.split("@")[1], 10) || 0;
          const d = Math.abs(mt - l.ts);
          return d < acc.d ? { d, m, mt } : acc;
        },
        { d: Infinity, m: null, mt: 0 }
      );
      console.log("  leak " + l.u + " @ " + l.ts + " ~ closest fixture mark: " + JSON.stringify(best.m) + " (delta " + best.d + "ms)");
    }
  }
  if (!pass) {
    const clicks = JSON.stringify(r.clicks);
    if (clicks && clicks !== "undefined") console.log("  clicks seen by page: " + clicks);
    const attempts = JSON.stringify(r.attempts);
    if (attempts && attempts !== "undefined") console.log("  fixture timeline: " + attempts);
  }
  return pass;
}

function wsEvaluate(wsUrl, expression) {
  return wsCall(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  }).then((msg) => {
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result && msg.result.result && msg.result.result.value;
  });
}

// Registered content scripts apply to *future* navigations, so the test page
// must not load until the service worker has actually registered the guard.
async function waitGuardRegistered(cdpPort, maxMs) {
  const deadline = Date.now() + maxMs;
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
  if (!fs.existsSync(CHROME)) {
    console.log("e2e-guard: Chrome not found at " + CHROME);
    process.exit(1);
  }
  sweepOrphans();

  let res = await runMode(true);
  console.log(res.headless ? "  (mode: headless=new)" : "  (mode: headed)");
  if (!res.cdpOk || !res.report || res.report.guard !== true) {
    console.log("e2e-guard: headless run had no active guard, retrying headed...");
    res = await runMode(false);
    console.log("  (mode: headed)");
  }

  const pass = await evaluate(res);
  if (pass === false && res.stderr) {
    console.log("  --- last extension-relevant stderr ---");
    console.log("  " + res.stderr.replace(/\n/g, "\n  "));
  }
  console.log(
    pass
      ? "e2e-guard: OK — every new-tab vector held in a real browser"
      : "e2e-guard: FAILED — at least one vector reached a real tab"
  );
  process.exit(pass ? 0 : 1);
}

main();