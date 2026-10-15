//
// Loads js/scriptlets.js in a vm with a minimal window/document stub and
// asserts the safe scriptlet subset behaves (no-adblocker neutralises globals,
// abort-current-script makes a property throw, remove-class strips a class,
// prevent-window-open returns null).
//
// Run:  node tools/test-scriptlets.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "js", "scriptlets.js");

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

function makeEl(cls) {
  const set = new Set(cls ? cls.split(" ").filter(Boolean) : []);
  return {
    _set: set,
    classList: {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      contains(c) { return set.has(c); }
    }
  };
}

function build() {
  const els = [makeEl("ad banner"), makeEl("ad"), makeEl("content")];
  const sandbox = {
    console: { warn() {}, log() {} },
    Object, Array, RegExp, String, Number, Math, Error, TypeError, ReferenceError,
    Set, Map, JSON, Date, parseInt, parseFloat, isNaN
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.navigator = {};
  sandbox.document = {
    documentElement: {},
    body: {},
    querySelectorAll(sel) {
      if (sel === ".ad") return els.filter((e) => e._set.has("ad"));
      return [];
    }
  };
  sandbox.CSS = { escape: (s) => String(s).replace(/([^a-zA-Z0-9_-])/g, "\\$1") };
  sandbox.MutationObserver = function () {
    this.observe = () => {};
    this.disconnect = () => {};
  };
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx, { filename: SRC });
  return { sandbox, els };
}

function run() {
  const { sandbox, els } = build();
  const api = sandbox.__uboScriptlets;
  ok(api && typeof api.run === "function", "exposes window.__uboScriptlets.run");
  const reg = api.registry;
  ok(typeof reg["no-adblocker"] === "function", "registry has no-adblocker");
  ok(typeof reg["abort-current-script"] === "function", "registry has abort-current-script");
  ok(typeof reg["remove-class"] === "function", "registry has remove-class");
  ok(typeof reg["prevent-window-open"] === "function", "registry has prevent-window-open");

  // no-adblocker neutralises detection globals + functions. The globals are
  // replaced by a noop getter (reads as undefined) and known detector methods
  // are overwritten with the same noop.
  sandbox.check = function () { return true; };
  api.run(["no-adblocker"]);
  const desc = Object.getOwnPropertyDescriptor(sandbox, "adBlock");
  ok(!!desc && typeof desc.get === "function", "no-adblocker replaces adBlock with a getter");
  ok(desc && desc.configurable === true, "no-adblocker leaves the adBlock getter configurable");
  eq(sandbox.check, desc.get, "no-adblocker replaces a known detector function with the noop");

  // abort-current-script makes the named property throw when read.
  sandbox.myAdState = { loaded: true };
  api.run([{ name: "abort-current-script", args: ["myAdState"] }]);
  let threw = false;
  try {
    void sandbox.myAdState;
  } catch (e) {
    threw = true;
  }
  ok(threw, "abort-current-script makes the property throw on read");

  // abort-current-script on a missing nested path is a harmless no-op.
  let threw2 = false;
  try {
    api.run([{ name: "abort-current-script", args: ["nope.deep.thing"] }]);
  } catch (e) {
    threw2 = true;
  }
  ok(!threw2, "abort-current-script on a missing path does not throw");

  // remove-class strips the class from matching elements only.
  api.run([{ name: "remove-class", args: ["ad", ".ad"] }]);
  ok(!els[0]._set.has("ad") && !els[1]._set.has("ad"), "remove-class strips the class from matches");
  ok(els[2]._set.has("content"), "remove-class leaves non-matching elements alone");

  // remove-class with no selector falls back to the escaped class selector.
  const el2 = makeEl("tracker");
  sandbox.document.querySelectorAll = (sel) => (sel === ".tracker" ? [el2] : []);
  api.run([{ name: "remove-class", args: ["tracker"] }]);
  ok(!el2._set.has("tracker"), "remove-class derives a selector when none is given");

  // prevent-window-open neutralises window.open.
  api.run(["prevent-window-open"]);
  eq(sandbox.window.open("https://ads.example.com/pop"), null, "prevent-window-open returns null");

  console.log(`scriptlets: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log("  FAIL " + f);
    process.exit(1);
  }
  console.log("scriptlets: OK");
}

run();
