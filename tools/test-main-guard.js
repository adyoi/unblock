//
// Runs the guard in a stubbed DOM and asserts the behaviour that broke in
// production: popups and ad-driven new tabs blocked, media playback untouched,
// and the guard still in force after the page overwrites window.open.
//
// Run:  node tools/test-main-guard.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "js", "main-guard.js");

let passed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} (got ${String(actual)}, want ${String(expected)})`);
}

/* -------------------------------------------------------------- DOM stub */

let listeners = {};

function makeEl(tag, attrs) {
  attrs = attrs || {};
  const el = {
    tagName: (tag || "div").toUpperCase(),
    nodeType: 1,
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    children: [],
    parentElement: null,
    _attrs: Object.assign({}, attrs),
    getAttribute(n) {
      return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null;
    },
    hasAttribute(n) {
      return Object.prototype.hasOwnProperty.call(this._attrs, n);
    },
    setAttribute(n, v) { this._attrs[n] = v; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; }
  };
  return el;
}

function makeEvent(type, extra) {
  return Object.assign(
    {
      type,
      target: null,
      button: 0,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.propagationStopped = true; }
    },
    extra || {}
  );
}

function buildSandbox(opts) {
  listeners = {};
  const openedTabs = [];
  const navigated = [];
  const submittedForms = [];
  const svgClicked = [];
  const areaClicked = [];

  const document = {
    readyState: "loading",
    documentElement: makeEl("html"),
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement: (t) => makeEl(t),
    getElementById() { return null; }
  };

  // href lives on Location.prototype as an accessor so the guard can wrap it.
  const locProto = {
    get href() {
      return this._href;
    },
    set href(v) {
      this._href = v;
      navigated.push(["href", v]);
    }
  };
  const location = Object.create(locProto);
  location._href = "https://www.example.com/watch?v=1";
  location.hostname = (opts && opts.hostname) || "www.example.com";
  location.assign = function (u) {
    navigated.push(["assign", u]);
  };
  location.replace = function (u) {
    navigated.push(["replace", u]);
  };

  const nativeOpen = function (url, target, features) {
    openedTabs.push([url, target, features]);
    return { fakeWindow: true };
  };

  const anchorProto = makeEl("a");
  anchorProto._attrs = {};

  const formProto = {
    submit() {
      submittedForms.push(["submit", this]);
    },
    requestSubmit() {
      submittedForms.push(["requestSubmit", this]);
    }
  };

  const svgProto = {
    click() {
      svgClicked.push(this);
    }
  };

  const areaProto = {
    click() {
      areaClicked.push(this);
    }
  };

  const win = {
    document,
    location,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask,
    console,
    // native browser APIs the guard should wrap
    open: nativeOpen,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    HTMLAnchorElement: function () {}
  };
  win.window = win;
  win.self = win;
  win.top = win;
  win.parent = win;
  win.HTMLElement = function () {};
  win.HTMLAnchorElement.prototype = anchorProto;
  win.HTMLFormElement = function () {};
  win.HTMLFormElement.prototype = formProto;
  win.SVGAElement = function () {};
  win.SVGAElement.prototype = svgProto;
  win.HTMLAreaElement = function () {};
  win.HTMLAreaElement.prototype = areaProto;
  function StorageCtor() {
    this._s = {};
  }
  StorageCtor.prototype.getItem = function (k) {
    return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null;
  };
  StorageCtor.prototype.setItem = function (k, v) {
    this._s[k] = String(v);
  };
  win.Storage = StorageCtor;
  win.Element = function () {};
  win.Node = { ELEMENT_NODE: 1 };
  win.Location = function () {};
  win.Location.prototype = locProto;
  const WindowCtor = function Window() {};
  win.Window = WindowCtor;
  win.Window.prototype = { open: nativeOpen, constructor: WindowCtor };

  const sandbox = {
    window: win,
    document,
    location,
    console,
    setTimeout: win.setTimeout,
    clearTimeout,
    setInterval: win.setInterval,
    clearInterval,
    queueMicrotask,
    setTimeoutSync: null,
    Error,
    TypeError,
    Object,
    String,
    Array,
    Set,
    Map,
    WeakSet,
    JSON,
    RegExp,
    URL,
    Promise,
    Math,
    Date,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);

  const code = fs.readFileSync(SRC, "utf8");
  vm.runInContext(code, ctx, { filename: SRC });

  return {
    win,
    sandbox,
    nativeOpen,
    openedTabs,
    navigated,
    submittedForms,
    svgClicked,
    areaClicked,
    fire(type, ev) {
      const fns = (listeners[type] || []).slice();
      for (const fn of fns) fn(ev);
      return ev;
    },
    hasListener(type) {
      return (listeners[type] || []).length > 0;
    },
    get listeners() {
      return listeners;
    },
    anchorProto
  };
}

/* ------------------------------------------------------------------ tests */

function run() {
  const env = buildSandbox();
  const { win, sandbox, openedTabs, navigated, fire } = env;

  ok(win.__unblockGuardInstalled__ === true, "guard did not install its marker");

  // 1. window.open is fully blocked (popups may rewrite themselves)
  const r1 = win.open("https://ads.example.com/popup", "_blank", "width=400");
  eq(r1, null, "window.open on ad URL must return null");
  eq(openedTabs.length, 0, "window.open on ad URL must not open a tab");

  const r2 = win.open("https://example.com/offer");
  eq(r2, null, "window.open must return null for any URL");
  eq(openedTabs.length, 0, "window.open must never open a tab");

  const r3 = win.open();
  eq(r3, null, "window.open() with no URL must also return null (blank window can be written into)");
  eq(openedTabs.length, 0, "window.open() with no URL must not open a tab");

  // 3. navigation to ad-like URLs is cancelled
  win.location.assign("https://adserver.example.com/track/1");
  eq(navigated.filter((n) => n[0] === "assign").length, 0, "location.assign to ad URL must be cancelled");

  win.location.replace("https://ads.cdn.example.net/x");
  eq(navigated.filter((n) => n[0] === "replace").length, 0, "location.replace to ad URL must be cancelled");

  win.location.assign("https://example.com/next-video");
  eq(
    navigated.filter((n) => n[0] === "assign" && n[1] === "https://example.com/next-video").length,
    1,
    "location.assign to a normal URL must still work"
  );

  // 3b. direct location.href assignment (= the clickunder) is the same blocker
  win.location.href = "https://adserver.example.com/track/2";
  eq(navigated.filter((n) => n[0] === "href").length, 0, "location.href = ad URL must be cancelled");

  win.location.href = "https://example.com/watch?v=2";
  eq(navigated.filter((n) => n[0] === "href").length, 1, "location.href = normal URL must still work");
  eq(win.location.href, "https://example.com/watch?v=2", "location.href getter must still read through the wrapper");

  // 3c. host blacklist: ad-chain hosts that carry no ad-word in the path must
  //     still be cancelled (e.g. the brotcdn backunder redirect to hai8g.com).
  win.location.href = "https://hai8g.com/4/7338006";
  eq(navigated.filter((n) => n[0] === "href" && n[1] === "https://hai8g.com/4/7338006").length, 0, "location.href to a blocked host must be cancelled");

  win.location.assign("https://hai8g.com/x");
  eq(navigated.filter((n) => n[0] === "assign" && n[1] === "https://hai8g.com/x").length, 0, "location.assign to a blocked host must be cancelled");

  win.location.replace("https://sub.brotcdn.xyz/clip.mp4");
  eq(navigated.filter((n) => n[0] === "replace" && n[1] === "https://sub.brotcdn.xyz/clip.mp4").length, 0, "location.replace to a blocked subdomain must be cancelled");

  win.location.href = "https://example.com/next";
  eq(navigated.filter((n) => n[0] === "href" && n[1] === "https://example.com/next").length, 1, "location.href to a normal URL must still work after host checks");

  const hostAnchorPlain = makeEl("a", { href: "https://brotcdn.xyz/yHuYvI82r2.mp4" });
  const hostClick = fire("click", makeEvent("click", { target: hostAnchorPlain }));
  eq(hostClick.defaultPrevented, true, "in-page link to a blocked host must be vetoed");

  const hostForm = makeEl("form", { action: "https://hai8g.com/4/7262551" });
  win.HTMLFormElement.prototype.submit.call(hostForm);
  eq(env.submittedForms.length, 0, "form.submit() to a blocked host must not submit");

  // 4. self-healing: page tries to replace window.open with its own popup factory
  win.open = function hijack() {
    return { hijacked: true };
  };
  eq(win.open.__unblock === true, true, "assignment to window.open must be ignored (guard still installed)");
  const r4 = win.open("https://ads.example.com/popup");
  eq(r4, null, "replaced window.open must still return null");
  eq(openedTabs.length, 0, "page hijack must not be able to open a tab");

  // 6. new-tab attempts must be blocked even with a perfectly clean URL
  const cleanBlank = makeEl("a", { href: "https://example.com/page", target: "_blank" });
  const cleanClick = fire("click", makeEvent("click", { target: cleanBlank }));
  eq(cleanClick.defaultPrevented, true, "target=_blank with a clean URL must still be blocked");

  const ctrlClick = fire("click", makeEvent("click", { target: cleanBlank, ctrlKey: true }));
  eq(ctrlClick.defaultPrevented, true, "ctrl+click must be blocked");

  const plain = makeEl("a", { href: "https://example.com/page" });
  const plainClick2 = fire("click", makeEvent("click", { target: plain }));
  eq(plainClick2.defaultPrevented, false, "ordinary in-page link click must still work");

  const mediaBlank = makeEl("a", { href: "https://example.com/v", target: "_blank" });
  mediaBlank.parentElement = makeEl("video");
  const mediaClick = fire("click", makeEvent("click", { target: mediaBlank }));
  eq(mediaClick.defaultPrevented, true, "target=_blank anchor inside a player must still be blocked (popunder vector)");

  const mediaWrap = makeEl("div", { class: "video-player" });
  mediaWrap.querySelector = () => makeEl("video");
  const overlay = makeEl("a", { href: "https://example.com/offer", target: "_blank" });
  overlay.parentElement = mediaWrap;
  const overlayClick = fire("click", makeEvent("click", { target: overlay }));
  eq(overlayClick.defaultPrevented, true, "clean-URL target=_blank overlay inside a player wrapper must be blocked");

  // 7. <form target="_blank"> bypasses the anchor rules, so it needs its own veto
  const form = makeEl("form", { target: "_blank" });
  const submit = fire("submit", makeEvent("submit", { target: form }));
  eq(submit.defaultPrevented, true, "form target=_blank must be blocked");

  const formSelf = makeEl("form", { target: "_self" });
  const submit2 = fire("submit", makeEvent("submit", { target: formSelf }));
  eq(submit2.defaultPrevented, false, "ordinary form submit must not be blocked");

  // 7b. form.submit() fires no submit event, so the sealed prototype method has
  //     to carry the same policy by itself.
  const fBlank = makeEl("form", { target: "_blank", action: "/x" });
  win.HTMLFormElement.prototype.submit.call(fBlank);
  eq(env.submittedForms.length, 0, "form.submit() on target=_blank must not navigate");

  const fAd = makeEl("form", { action: "https://adserver.example.com/x" });
  win.HTMLFormElement.prototype.submit.call(fAd);
  eq(env.submittedForms.length, 0, "form.submit() with an ad action must not navigate");

  const fSelf2 = makeEl("form", { action: "/ok" });
  win.HTMLFormElement.prototype.submit.call(fSelf2);
  eq(env.submittedForms.length, 1, "form.submit() on a normal form target must still submit");

  // 7c. SVG anchors report a lowercase tagName ("a") and AREA elements carry
  //     href+target too; both must be vetoed like a plain <a>.
  const svgLink = makeEl("a", { href: "https://example.com/x", target: "_blank" });
  svgLink.tagName = "a";
  const svgEv = fire("click", makeEvent("click", { target: svgLink }));
  eq(svgEv.defaultPrevented, true, "SVG <a> (lowercase tagName) target=_blank must be blocked");

  const areaEv2 = fire("click", makeEvent("click", { target: makeEl("area", { href: "https://example.com/map", target: "_blank" }) }));
  eq(areaEv2.defaultPrevented, true, "AREA target=_blank click must be blocked");

  win.SVGAElement.prototype.click.call(makeEl("svg", { href: "https://example.com/x", target: "_blank" }));
  eq(env.svgClicked.length, 0, "SVGAElement.click on target=_blank must be blocked");
  win.SVGAElement.prototype.click.call(makeEl("svg", { href: "https://example.com/x" }));
  eq(env.svgClicked.length, 1, "SVGAElement.click on a clean svg anchor must still work");

  win.HTMLAreaElement.prototype.click.call(makeEl("area", { href: "https://ads.example.net/x", target: "_blank" }));
  eq(env.areaClicked.length, 0, "HTMLAreaElement.click on ad target=_blank must be blocked");
  win.HTMLAreaElement.prototype.click.call(makeEl("area", { href: "https://example.com/map" }));
  eq(env.areaClicked.length, 1, "HTMLAreaElement.click on a clean area must still work");

  // 8. no mousedown interception - it would swallow context menus
  const md = fire("mousedown", makeEvent("mousedown", { target: plain, button: 2 }));
  eq(md.defaultPrevented, false, "mousedown must not be intercepted");

  // 9. media controls keep working
  const video = makeEl("video");
  const btn = makeEl("button", { "aria-label": "Play" });
  btn.parentElement = video;
  const click = fire("click", makeEvent("click", { target: btn }));
  eq(click.defaultPrevented, false, "click on a media control must not be blocked");

  const playBtn = makeEl("button", { "aria-label": "Play video" });
  const wrapper = makeEl("div");
  wrapper.querySelectorAll = () => new Array(4); // small subtree
  wrapper.querySelector = () => video;
  playBtn.parentElement = wrapper;
  const click2 = fire("click", makeEvent("click", { target: playBtn }));
  eq(click2.defaultPrevented, false, "click on an overlay play button must not be blocked");

  // 6. non-media clicks are not stopped (page listeners must still run)
  const div = makeEl("div", { class: "content" });
  const plainClick = fire("click", makeEvent("click", { target: div }));
  eq(plainClick.propagationStopped, false, "guard must never stopPropagation on ordinary clicks");

  // 7. BFCache restore: page shows again and re-tries to install its own open()
  const beforeShow = win.open.__unblock;
  fire("pageshow", makeEvent("pageshow"));
  eq(win.open.__unblock, beforeShow, "pageshow must leave the guarded window.open in place");
  eq(win.open("https://example.com/pop"), null, "window.open must still be blocked after pageshow");

  // 8. re-injection into a document that already has the guard must be a no-op
  const env2 = buildSandbox();
  const openBefore = env2.win.open;
  const clicksBefore = (env2.listeners.click || []).length;
  vm.runInContext(fs.readFileSync(SRC, "utf8"), vm.createContext(env2.sandbox), { filename: SRC });
  eq(env2.win.open, openBefore, "second injection must not re-wrap window.open");
  eq((env2.listeners.click || []).length, clicksBefore, "second injection must not stack duplicate listeners");

  // 9. media exemption must not leak to the whole page
  const body = makeEl("body");
  body.querySelectorAll = () => new Array(500); // large subtree -> not a player wrapper
  body.querySelector = () => makeEl("video");
  const row = makeEl("div", { class: "row" });
  row.parentElement = body;
  const big = fire("click", makeEvent("click", { target: row }));
  eq(big.propagationStopped, false, "large page wrapper must not grant a media exemption");

  // 10. Window.prototype.open escapes must be sealed too (ad scripts call
  //     Window.prototype.open.call(window, url) to dodge the own-property seal)
  const rp = win.Window.prototype.open.call(win, "https://ads.example.com/popup", "_blank");
  eq(rp, null, "Window.prototype.open.call must return null");
  eq(openedTabs.length, 0, "Window.prototype.open.call must not open a tab");

  win.Window.prototype.open = function hijack2() {
    return { hijacked: true };
  };
  eq(win.Window.prototype.open("https://x.example/pop"), null, "assignment to Window.prototype.open must be ignored");
  eq(openedTabs.length, 0, "prototype hijack must not open a tab");

  // 11. cooldown-key lie: Videcloud-style backunder redirectors read a
  //     localStorage "last_backunder_time_*" key to decide whether to kick the
  //     tab to an ad host. On ad-chain hosts the guard fakes a fresh timestamp
  //     so that branch is skipped and nothing navigates.
  const normalGet = win.Storage.prototype.getItem;
  eq(normalGet.__unblockCooldown, undefined, "cooldown lie must not be armed on normal hosts");
  eq(normalGet.call({ _s: {} }, "last_backunder_time_abc"), null, "normal hosts still read storage untouched");

  const env3 = buildSandbox({ hostname: "brotcdn.xyz" });
  ok(env3.win.__unblockGuardInstalled__ === true, "blocked-host sandbox still installs the guard");
  eq(env3.win.open("https://example.com/offer"), null, "blocked-host sandbox still blocks window.open");
  const lieGet = env3.win.Storage.prototype.getItem;
  ok(lieGet.__unblockCooldown === true, "cooldown lie is armed on an ad-chain host");
  const fakeStorage = { _s: {} };
  const lieVal = lieGet.call(fakeStorage, "last_backunder_time_yHuYvI82r2");
  ok(/^\d{10,13}$/.test(lieVal), "backunder cooldown key reads as a fresh timestamp (got " + lieVal + ")");
  eq(lieGet.call(fakeStorage, "opened_ad_links"), null, "unrelated storage keys still read through natively");
  env3.fire("pageshow", makeEvent("pageshow"));
  ok(env3.win.Storage.prototype.getItem.__unblockCooldown === true, "pageshow must keep the cooldown lie armed");

  const env4 = buildSandbox({ hostname: "sub.brotcdn.xyz" });
  ok(env4.win.Storage.prototype.getItem.__unblockCooldown === true, "cooldown lie arms on blocked subdomains too");

  const env5 = buildSandbox({ hostname: "hai8g.com" });
  ok(env5.win.Storage.prototype.getItem.__unblockCooldown === true, "cooldown lie arms on the redirector host too");

  console.log(`main-guard: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log("  FAIL " + f);
    process.exit(1);
  }
  console.log("main-guard: OK");
}

run();
