//
// Loads js/background.js in a vm with a stubbed chrome API and asserts the DNR
// sync, whitelist/guard wiring and message handling. The stub deliberately
// rejects malformed rules the way Chrome does (allowAllRequests resource types,
// non-ASCII urlFilter, bad regex, duplicate ids) so those regressions fail here.
//
// Run:  node tools/test-background.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "js", "background.js");
const STATIC = ["default-block", "ads-lists-lite", "privacy-lite", "trackers-lite"];

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

function validateRules(rules) {
  const ids = new Set();
  for (const r of rules) {
    if (ids.has(r.id)) throw new Error("duplicate id " + r.id);
    ids.add(r.id);
    const c = r.condition || {};
    const a = r.action || {};
    if (a.type === "allowAllRequests") {
      const rt = c.resourceTypes || [];
      if (!rt.length) throw new Error("allowAllRequests needs resourceTypes");
      for (const t of rt) if (t !== "main_frame" && t !== "sub_frame") throw new Error("bad allowAllRequests rt " + t);
    } else if (!c.urlFilter && !c.regexFilter && !c.requestDomains && !c.initiatorDomains) {
      throw new Error("rule " + r.id + " has no match condition");
    }
    if (c.urlFilter && /[^\x20-\x7e]/.test(c.urlFilter)) throw new Error("non-ascii urlFilter");
    if (c.regexFilter) new RegExp(c.regexFilter);
  }
}

function buildEnv() {
  const store = { "unblock_settings": undefined };
  let dynamic = [];
  const enabled = new Set(STATIC);
  const registered = new Map();
  const io = { icons: [], css: [], script: [], tabMsgs: [], enabledCalls: [] };
  let onMessage = null;

  const chrome = {
    storage: {
      local: {
        async get(key) {
          const keys = Array.isArray(key) ? key : [key];
          const out = {};
          for (const k of keys) if (Object.prototype.hasOwnProperty.call(store, k) && store[k] !== undefined) out[k] = store[k];
          return out;
        },
        async set(obj) {
          for (const k of Object.keys(obj)) store[k] = JSON.parse(JSON.stringify(obj[k]));
        },
        async remove(k) {
          const keys = Array.isArray(k) ? k : [k];
          for (const key of keys) delete store[key];
        }
      }
    },
    action: {
      async setIcon(o) {
        io.icons.push(o.path);
      }
    },
    declarativeNetRequest: {
      async getEnabledRulesets() {
        return Array.from(enabled);
      },
      async updateEnabledRulesets(u) {
        io.enabledCalls.push(u);
        for (const id of u.disableRuleIds || []) enabled.delete(id);
        for (const id of u.enableRuleIds || []) enabled.add(id);
      },
      async getDynamicRules() {
        return dynamic.map((r) => JSON.parse(JSON.stringify(r)));
      },
      async updateDynamicRules(u) {
        if (u.addRules) validateRules(u.addRules);
        if (u.removeRuleIds) dynamic = dynamic.filter((r) => u.removeRuleIds.indexOf(r.id) === -1);
        if (u.addRules) dynamic = dynamic.concat(JSON.parse(JSON.stringify(u.addRules)));
      }
    },
    scripting: {
      async getRegisteredContentScripts() {
        return Array.from(registered.values());
      },
      async registerContentScripts(specs) {
        for (const s of specs) {
          if (registered.has(s.id)) throw new Error("duplicate script id " + s.id);
          registered.set(s.id, s);
        }
      },
      async unregisterContentScripts(o) {
        for (const id of o.ids) registered.delete(id);
      },
      async insertCSS(o) {
        io.css.push(o.files[0]);
      },
      async executeScript(o) {
        io.script.push({ files: o.files, world: o.world });
      }
    },
    tabs: {
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      async sendMessage(id, m) {
        io.tabMsgs.push({ id, m });
      }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          onMessage = fn;
        }
      }
    }
  };

  const sandbox = {
    chrome,
    console: { warn() {}, log() {} },
    Promise,
    URL,
    RegExp,
    Object,
    Array,
    Map,
    Set,
    JSON,
    String,
    Number,
    Math,
    Date,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout,
    clearTimeout,
    queueMicrotask
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx, { filename: SRC });

  function send(msg, sender) {
    return new Promise((resolve) => {
      let done = false;
      const cb = (resp) => {
        if (!done) {
          done = true;
          resolve(resp);
        }
      };
      const ret = onMessage(msg, sender || {}, cb);
      ok(ret === true, "onMessage must return true to keep the channel open");
      setTimeout(() => {
        if (!done) resolve("NO_RESPONSE");
      }, 60);
    });
  }

  return {
    chrome,
    io,
    send,
    store,
    get dynamic() {
      return dynamic;
    },
    get registered() {
      return registered;
    },
    enabled
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (rules, lo, hi) => rules.filter((r) => r.id >= lo && r.id <= hi).map((r) => r.id).sort((a, b) => a - b);

async function run() {
  const env = buildEnv();
  await wait(20);

  eq(env.enabled.size, 4, "initial sync leaves all static rulesets enabled");

  let r = await env.send({ type: "getSettings" });
  eq(r.ok, true, "getSettings responds ok");
  eq(r.settings.enabled, true, "defaults have blocking enabled");
  eq(r.settings.advancedDefenses, true, "defaults keep advanced defenses on");

  const guard = env.registered.get("unblock-main-guard");
  ok(!!guard, "advanced defenses on + enabled registers the guard");
  eq(guard.world, "MAIN", "guard runs in MAIN world");
  eq(guard.runAt, "document_start", "guard runs at document_start");
  eq(guard.matchAboutBlank, undefined, "registerContentScripts rejects matchAboutBlank (manifest-only key)");
  ok(!!guard.excludeMatches, "guard has excludeMatches");

  r = await env.send({ type: "toggle", enabled: false });
  eq(r.settings.enabled, false, "toggle off is persisted/returned");
  eq(env.enabled.size, 0, "toggle off disables every static ruleset");
  ok(!env.registered.has("unblock-main-guard"), "toggle off unregisters the guard");
  eq(ids(env.dynamic, 10000, 12999).length, 0, "toggle off clears custom dynamic rules");

  r = await env.send({ type: "toggle", enabled: true });
  eq(env.enabled.size, 4, "toggle on re-enables all rulesets");
  ok(env.registered.has("unblock-main-guard"), "toggle on re-registers the guard");

  r = await env.send({ type: "addWhitelist", domain: "https://Ads.Example.com/path?q=1" });
  eq(r.ok, true, "valid whitelist domain accepted");
  ok(r.settings.whitelist.indexOf("ads.example.com") !== -1, "domain is normalized to hostname");
  const wl = env.dynamic.filter((x) => x.id >= 1000 && x.id <= 1999);
  eq(wl.length, 2, "one whitelist entry becomes two rules");
  const frameRule = wl.filter((x) => x.action.type === "allowAllRequests")[0];
  eq(JSON.stringify(frameRule.condition.resourceTypes), JSON.stringify(["main_frame", "sub_frame"]), "allowAllRequests uses only frame types");
  eq(frameRule.priority, 99, "whitelist frame rule wins over static rules");
  const subRule = wl.filter((x) => x.action.type === "allow")[0];
  ok(subRule.condition.initiatorDomains.indexOf("ads.example.com") !== -1, "subresource allow is initiator-scoped");
  const guard2 = env.registered.get("unblock-main-guard");
  ok(guard2.excludeMatches.indexOf("*://ads.example.com/*") !== -1, "guard excludes whitelisted host");
  ok(guard2.excludeMatches.indexOf("*://*.ads.example.com/*") !== -1, "guard excludes whitelisted subdomains");

  r = await env.send({ type: "addWhitelist", domain: "*" });
  eq(r.ok, false, "wildcard-only domain is rejected");
  eq(r.error, "invalid_domain", "reject reports invalid_domain");

  r = await env.send({ type: "removeWhitelist", domain: "ads.example.com" });
  eq(ids(env.dynamic, 1000, 1999).length, 0, "removing whitelist drops its rules");
  ok(env.registered.get("unblock-main-guard").excludeMatches.length === 0, "guard exclusions cleared");

  r = await env.send({ type: "setWhitelist", domains: ["Example.org", "example.org", "not a domain", "sub.example.net:8080"] });
  eq(r.ok, true, "setWhitelist responds ok");
  eq(JSON.stringify(r.settings.whitelist), JSON.stringify(["example.org", "sub.example.net"]), "setWhitelist dedups and sanitizes");
  await env.send({ type: "clearWhitelist" });
  eq(env.dynamic.filter((x) => x.id >= 1000 && x.id <= 1999).length, 0, "clearWhitelist removes all whitelist rules");

  const rules = [
    "! a comment",
    "[Adblock Plus 2.0]",
    "example.com##.ad-slot",
    "##.global-banner",
    "||ads.net^$script",
    "/ad\\d+/",
    "||tracker.example",
    "||*.cdn.example",
    "banner_gif.gif",
    "||bad.example/\u65e5\u672c\u8a9e"
  ];
  r = await env.send({ type: "saveCustomRules", rules });
  eq(r.ok, true, "saveCustomRules responds ok");
  const custom = env.dynamic.filter((x) => x.id >= 10000 && x.id <= 12999);
  const regexRules = custom.filter((x) => x.condition.regexFilter);
  eq(regexRules.length, 1, "only the regex rule becomes regexFilter");
  eq(regexRules[0].condition.regexFilter, "ad\\d+", "regex body is passed through");
  const domRules = custom.filter((x) => x.condition.requestDomains);
  eq(domRules.length, 2, "bare ||domain and ||*.domain become requestDomains");
  ok(domRules.some((x) => x.condition.requestDomains[0] === "tracker.example"), "||tracker.example -> requestDomains");
  ok(domRules.some((x) => x.condition.requestDomains[0] === "cdn.example"), "||*.cdn.example -> wildcard host");
  const urlRules = custom.filter((x) => x.condition.urlFilter);
  eq(urlRules.length, 1, "plain pattern becomes urlFilter");
  eq(urlRules[0].condition.urlFilter, "banner_gif.gif", "urlFilter keeps the raw pattern");
  for (const x of custom) {
    ok(x.condition.domainType === "thirdParty", "custom rule " + x.id + " is thirdParty scoped");
    ok((x.condition.resourceTypes || []).indexOf("main_frame") === -1, "custom rule " + x.id + " never blocks main_frame");
  }

  r = await env.send({ type: "saveCustomRules", rules: ["/ad[/", "||*", "||legit.example"] });
  eq(r.ok, true, "invalid patterns do not fail the save");
  const custom2 = env.dynamic.filter((x) => x.id >= 10000 && x.id <= 12999);
  eq(custom2.filter((x) => x.condition.regexFilter).length, 0, "broken regex is dropped");
  ok(custom2.some((x) => x.condition.requestDomains && x.condition.requestDomains[0] === "legit.example"), "valid rule survives a bad sibling");

  r = await env.send({ type: "addCustomRule", rule: "##.picked-by-picker" });
  eq(r.ok, true, "addCustomRule responds ok");
  ok(r.settings.customRules.indexOf("##.picked-by-picker") !== -1, "cosmetic picker rule is stored");
  eq(env.dynamic.filter((x) => x.condition.urlFilter === "##.picked-by-picker").length, 0, "cosmetic rule is not sent to DNR");
  const before = r.settings.customRules.length;
  r = await env.send({ type: "addCustomRule", rule: "##.picked-by-picker" });
  eq(r.settings.customRules.length, before, "duplicate cosmetic rule is ignored");

  r = await env.send({ type: "setAdvancedDefenses", enabled: false });
  eq(r.settings.advancedDefenses, false, "advanced defenses toggle persists");
  ok(!env.registered.has("unblock-main-guard"), "turning off advanced defenses removes the guard");
  r = await env.send({ type: "setAdvancedDefenses", enabled: true });
  ok(env.registered.has("unblock-main-guard"), "turning advanced defenses back on restores the guard");

  r = await env.send({ type: "setHeuristics", enabled: false });
  eq(r.settings.heuristicsEnabled, false, "heuristics toggle persists");
  await env.send({ type: "setHeuristics", enabled: true });

  r = await env.send({ type: "toggleScriptletsAllowlist", domain: "example.com" });
  ok(r.settings.scriptletsAllowlist.indexOf("example.com") !== -1, "scriptlet allowlist adds domain");
  r = await env.send({ type: "toggleScriptletsAllowlist", domain: "example.com" });
  eq(r.settings.scriptletsAllowlist.indexOf("example.com"), -1, "scriptlet allowlist toggles back off");

  const cssBefore = env.io.css.length;
  const jsBefore = env.io.script.length;
  r = await env.send({ type: "startPicker", tabId: 7 });
  eq(r.ok, true, "startPicker responds ok");
  eq(env.io.css.length, cssBefore + 1, "startPicker injects the picker stylesheet");
  eq(env.io.css[env.io.css.length - 1], "css/picker.css", "the injected stylesheet is picker.css");
  eq(env.io.script.length, jsBefore + 1, "startPicker injects picker.js");
  eq(env.io.script[env.io.script.length - 1].files[0], "js/picker.js", "the injected script is picker.js");
  eq(env.io.script[env.io.script.length - 1].world, "MAIN", "picker.js runs in the page world (needs DOM access)");
  const lastMsg = env.io.tabMsgs[env.io.tabMsgs.length - 1];
  eq(lastMsg.m.type, "pickerStarted", "picker arms the content script via tabs.sendMessage");

  r = await env.send({ type: "startPicker" });
  eq(r.ok, true, "startPicker without a tab id is a harmless no-op");

  r = await env.send({ type: "nonsense" });
  eq(r.ok, false, "unknown message is rejected");
  eq(r.error, "unknown", "unknown message reports error=unknown");

  r = await env.send(null);
  eq(r.ok, false, "null message is rejected without throwing");

  console.log(`background: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log("  FAIL " + f);
    process.exit(1);
  }
  console.log("background: OK");
}

run().catch((e) => {
  console.log("background: harness error", e);
  process.exit(1);
});
