// Unblock - MAIN world popup / new-tab guard
//
// Runs at document_start in the page's own JS context so it can observe and
// intercept the real navigation APIs (window.open, anchor .click(), navigation).
//
// Design rules that keep this from breaking real sites:
//   * Installed once per document (marker flag) - never nested.
//   * window.open is a self-healing accessor: page code cannot overwrite it.
//   * The DOM guard only ever calls preventDefault() + stopPropagation().
//     It never calls stopImmediatePropagation(), so page listeners (video
//     players, SPA routers) keep working.
//   * The trusted-event guard ignores synthetic events; programmatic clicks are
//     handled by the HTMLAnchorElement.prototype.click patch instead.
//   * Media controls are exempted on the target AND on every ancestor.
//   * window.open is blocked unconditionally; location.* and anchors are only
//     cancelled for URLs matching an ad pattern. Over-blocking navigation is
//     what previously made sites stop responding after a reload.

(() => {
  const MARK = '__unblockGuardInstalled__';
  if (window[MARK]) return;
  try {
    Object.defineProperty(window, MARK, { value: true, enumerable: false, configurable: false, writable: false });
  } catch (e) {
    if (window[MARK]) return;
    window[MARK] = true;
  }

  const AD_PATTERNS = [
    'googlesyndication', 'doubleclick.net', 'googleadservices', 'adservice',
    'adserv', 'adsystem', 'adserver', 'adserve', 'adsrv', 'adnxs', 'adclick',
    'adservice.', 'redirect.ads', 'ads.', 'adservice/', '/ads/', '/ad/',
    '/banner', 'banner.', 'popads', 'popunder', 'pop-up', 'popup',
    'taboola', 'outbrain', 'propellerads', 'propeller', 'clickadu',
    'exoclick', 'exosrv', 'juicyads', 'adskeeper', 'hilltopads',
    'onclickads', 'onclckds', 'popcash', 'popcpm', 'trafficjunky',
    'landingpage', 'pocout', 'zonads', 'adcash', 'adster', 'adiquity'
  ];

  const BLOCK_TARGETS = new Set(['_blank', '_popup', 'popup', '_new']);

  const BLOCKED_HOSTS = new Set(['hai8g.com', 'brotcdn.xyz']);

  const isBlockedSite = (raw) => {
    let host = '';
    try {
      let s = String(raw).trim();
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
      host = new URL(s).hostname.toLowerCase();
    } catch (e) {
      return false;
    }
    while (host) {
      if (BLOCKED_HOSTS.has(host)) return true;
      const dot = host.indexOf('.');
      if (dot < 0) break;
      host = host.slice(dot + 1);
    }
    return false;
  };

  const baseAdish = (raw) => {
    if (!raw) return false;
    let s;
    try {
      s = String(raw).toLowerCase();
    } catch (e) {
      return false;
    }
    if (s.length > 2048) s = s.slice(0, 2048);
    for (let i = 0; i < AD_PATTERNS.length; i++) {
      if (s.includes(AD_PATTERNS[i])) return true;
    }
    return false;
  };

  const MEDIA_TAGS = new Set(['VIDEO', 'AUDIO', 'SOURCE', 'TRACK']);

  const MEDIA_WORDS = [
    'play', 'pause', 'stop', 'volume', 'mute', 'unmute', 'fullscreen',
    'full screen', 'seek', 'rewind', 'forward', 'next', 'previous',
    'prev', 'subtitle', 'caption', 'quality', 'speed', 'loop', 'autoplay',
    'picture-in-picture', 'pip', 'replay', 'scrub', 'timeline', 'expand'
  ];

  const MEDIA_WRAPPER_SEL = [
    '[class*="player" i]', '[id*="player" i]',
    '[class*="video" i]', '[id*="video" i]',
    '[class*="media" i]', '[id*="media" i]',
    '[class*="watch" i]', '[id*="watch" i]'
  ].join(',');

  const isAdish = (raw) => {
    if (baseAdish(raw)) return true;
    if (isBlockedSite(raw)) return true;
    return false;
  };

  const BACKUNDER_KEY_MARK = 'last_backunder_time_';

  const armCooldownLie = () => {
    if (!isBlockedSite(location.hostname)) return;
    const proto = window.Storage && window.Storage.prototype;
    const origGet = proto && proto.getItem;
    if (!origGet) return;
    if (proto.getItem && proto.getItem.__unblockCooldown) return;
    const lie = function (key) {
      if (typeof key === 'string' && key.indexOf(BACKUNDER_KEY_MARK) === 0) {
        return String(Date.now());
      }
      return origGet.call(this, key);
    };
    try {
      Object.defineProperty(lie, '__unblockCooldown', { value: true });
      proto.getItem = lie;
    } catch (e) {}
  };
  armCooldownLie();

  const hasMediaWord = (str) => {
    if (!str) return false;
    for (let i = 0; i < MEDIA_WORDS.length; i++) {
      if (str.includes(MEDIA_WORDS[i])) return true;
    }
    return false;
  };

  // True when the node is a media element, lives inside one, is a labelled media
  // control, or sits inside a player wrapper that owns a media element.
  //
  // Deliberately conservative: the media exemption is the only thing standing
  // between a real player and a false positive, so every broad check below is
  // bounded (few ancestors, small subtree, shallow class/id match). Over-matching
  // here would silently disable the popup guard across the whole page.
  const isMediaNode = (node, depth) => {
    let el = node;
    let hops = 0;
    const max = depth === undefined ? 3 : depth;

    while (el && el.nodeType === 1 && hops <= max) {
      hops++;
      if (MEDIA_TAGS.has(el.tagName)) return true;

      if (typeof el.getAttribute === 'function') {
        if (el.hasAttribute('controls') || el.hasAttribute('poster')) return true;
        if (hops <= 1) {
          const cls = (el.getAttribute('class') || '').toLowerCase();
          const id = (el.getAttribute('id') || '').toLowerCase();
          if (hasMediaWord(cls) || hasMediaWord(id)) return true;
        }
      }

      // Overlay play buttons are usually siblings of the media element. Only
      // trust this for small subtrees, otherwise a page-level wrapper that
      // merely contains a video would exempt every click on the site.
      if (hops <= 2 && typeof el.querySelectorAll === 'function') {
        try {
          const kids = el.querySelectorAll('*');
          if (kids.length <= 6 && el.querySelector('video,audio,source,track')) return true;
        } catch (e) {}
      }

      if (typeof el.closest === 'function') {
        try {
          if (el.closest('video,audio')) return true;
        } catch (e2) {}
      }

      el = el.parentElement;
    }
    return false;
  };

  const isMediaControl = (node) => {
    try {
      if (!node || node.nodeType !== 1) return false;
      if (typeof node.closest !== 'function') return false;

      const label = [
        node.getAttribute('aria-label') || '',
        node.getAttribute('title') || '',
        node.getAttribute('data-title') || '',
        node.getAttribute('data-action') || '',
        (node.textContent || '').slice(0, 40)
      ].join(' ').toLowerCase();
      if (hasMediaWord(label)) return true;

      const wrap = node.closest(MEDIA_WRAPPER_SEL);
      if (wrap) {
        try {
          if (wrap.querySelector('video,audio,source,track')) return true;
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  };

  const isMediaEvent = (target) => isMediaNode(target) || isMediaControl(target);

  // ---------------------------------------------------------------- navigation
  // window.open is a popup factory: it is blocked for every URL, including the
  // no-argument form (a blank window the page can then document.write into).
  const navGuard = (native, self, args, kind) => {
    if (kind === "open") return null;
    const url = args[0];
    if (url === undefined || url === null) {
      return native ? native.apply(self, args) : null;
    }
    try {
      if (isAdish(url)) return undefined;
    } catch (e) {}
    try {
      return native ? native.apply(self, args) : undefined;
    } catch (e) {
      try {
        return native ? native.apply(self, args) : undefined;
      } catch (e2) {
        return undefined;
      }
    }
  };

  // ------------------------------------------------- self-healing window.open
  const nativeOpen = typeof window.open === 'function' ? window.open : null;
  const blockedOpen = function (url, target, features) {
    return navGuard(nativeOpen, window, arguments, 'open');
  };
  blockedOpen.__unblock = true;

  const sealOpen = () => {
    try {
      Object.defineProperty(window, 'open', {
        configurable: true,
        enumerable: true,
        get() {
          return blockedOpen;
        },
        set(v) {
          // Page tried to replace window.open - ignore it on purpose.
          if (v && v.__unblock) return;
          try {
            Object.defineProperty(window, 'open', {
              configurable: true,
              enumerable: true,
              get() { return blockedOpen; },
              set() {}
            });
          } catch (e) {}
        }
      });
      return true;
    } catch (e) {
      try {
        window.open = blockedOpen;
        return window.open === blockedOpen;
      } catch (e2) {
        return false;
      }
    }
  };

sealOpen();

  // Ad scripts that must survive a sealed window.open fall back to the
  // prototype slot, e.g. Window.prototype.open.call(window, url) or
  // delete window.open to expose it again. Seal that slot too.
  const sealProtoOpen = () => {
    try {
      const proto = window.Window && window.Window.prototype;
      if (!proto || typeof proto !== 'object') return false;
      const cur = Object.getOwnPropertyDescriptor(proto, 'open');
      if (cur && cur.get && cur.get.call(proto) === blockedOpen) return true;
      Object.defineProperty(proto, 'open', {
        configurable: true,
        enumerable: true,
        get() {
          return blockedOpen;
        },
        set() {}
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  sealProtoOpen();

  // ------------------------------------------------------- programmatic clicks
  // Saved on window so the re-seal interval can put it back if the page
  // overwrites HTMLAnchorElement.prototype.click after we install.
  let guardedClickRef = null;
  let anchorProtoRef = null;
  try {
    const proto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype;
    const nativeClick = proto && proto.click;
    if (typeof nativeClick === 'function') {
      const guardedClick = function () {
        try {
          // Media first: a player's own control must never be swallowed.
          // The parent-element check is intentionally shallow: an ad anchor
          // dropped inside the player wrapper must not inherit the exemption.
          if (isMediaControl(this)) {
            return nativeClick.apply(this, arguments);
          }
          const href = this.getAttribute('href') || '';
          const target = (this.getAttribute('target') || '').toLowerCase();

          if (BLOCK_TARGETS.has(target)) return undefined;
          if (href) {
            if (isAdish(href)) return undefined;
            if (href.toLowerCase().indexOf('javascript:') === 0) {
              const body = decodeURIComponent(href.slice(11));
              if (body.includes('window.open') || body.includes('location')) return undefined;
            }
          }
        } catch (e) {}
        return nativeClick.apply(this, arguments);
      };
      guardedClick.__unblock = true;
      proto.click = guardedClick;
      guardedClickRef = guardedClick;
      anchorProtoRef = proto;
    }
  } catch (e) {}

  // form.submit() does NOT raise a submit event (only requestSubmit does), so
  // the onSubmit listener can never see it: a target=_blank form would keep
  // navigating straight away. Seal the prototype method with the same policy.
  let guardedSubmitRef = null;
  let formProtoRef = null;
  try {
    const fproto = window.HTMLFormElement && window.HTMLFormElement.prototype;
    const nativeSubmit = fproto && fproto.submit;
    if (typeof nativeSubmit === 'function') {
      const guardedSubmit = function () {
        try {
          const action = this.getAttribute('action') || '';
          const target = (this.getAttribute('target') || '').toLowerCase();
          if (BLOCK_TARGETS.has(target)) return undefined;
          if (action && isAdish(action)) return undefined;
        } catch (e) {}
        return nativeSubmit.apply(this, arguments);
      };
      guardedSubmit.__unblock = true;
      fproto.submit = guardedSubmit;
      guardedSubmitRef = guardedSubmit;
      formProtoRef = fproto;
    }
  } catch (e) {}

  // SVG anchors (SVGAElement.tagName is the lowercase "a") and image-map AREA
  // elements carry href+target too; give them the same programmatic-click seal.
  const sealClickProto = (ctorKey, refs) => {
    try {
      const proto = window[ctorKey] && window[ctorKey].prototype;
      const native = proto && proto.click;
      if (typeof native !== 'function') return;
      const guarded = function () {
        let blocked = false;
        try {
          const href =
            this.getAttribute('href') ||
            (this.getAttribute && this.getAttribute('xlink:href')) ||
            '';
          const target = (this.getAttribute('target') || '').toLowerCase();
          if (BLOCK_TARGETS.has(target)) blocked = true;
          else if (href && isAdish(href)) blocked = true;
          else if (href && href.toLowerCase().indexOf('javascript:') === 0) {
            const body = decodeURIComponent(href.slice(11));
            if (body.includes('window.open') || body.includes('location')) blocked = true;
          }
        } catch (e) {}
        if (blocked) return undefined;
        return native.apply(this, arguments);
      };
      guarded.__unblock = true;
      proto.click = guarded;
      refs.guarded = guarded;
      refs.proto = proto;
    } catch (e) {}
  };
  const svgRefs = {};
  const areaRefs = {};
  sealClickProto('SVGAElement', svgRefs);
  sealClickProto('HTMLAreaElement', areaRefs);

  // Some pages re-define window.open / HTMLAnchorElement.prototype.click a beat
  // after document_start, or again on every route change. Re-seal repeatedly in
  // the first seconds and once per BFCache restore.
  let seals = 0;
  const sealTimer = setInterval(() => {
    seals++;
    try {
      if (window.open !== blockedOpen) sealOpen();
      const proto = window.Window && window.Window.prototype;
      if (proto && Object.getOwnPropertyDescriptor(proto, 'open')) {
        const cur = Object.getOwnPropertyDescriptor(proto, 'open');
        if (!(cur.get && cur.get.call(proto) === blockedOpen)) sealProtoOpen();
      }
      if (guardedClickRef && anchorProtoRef && anchorProtoRef.click !== guardedClickRef) {
        anchorProtoRef.click = guardedClickRef;
      }
      if (guardedSubmitRef && formProtoRef && formProtoRef.submit !== guardedSubmitRef) {
        formProtoRef.submit = guardedSubmitRef;
      }
      const svgG = svgRefs.guarded;
      if (svgG && svgRefs.proto && svgRefs.proto.click !== svgG) {
        svgRefs.proto.click = svgG;
      }
      const areaG = areaRefs.guarded;
      if (areaG && areaRefs.proto && areaRefs.proto.click !== areaG) {
        areaRefs.proto.click = areaG;
      }
    } catch (e) {}
    if (seals >= 40) clearInterval(sealTimer);
  }, 500);

  // location.assign / location.replace - guarded, and rolled back on failure.
  const nativeAssign = (() => {
    try {
      return typeof location.assign === 'function' ? location.assign : null;
    } catch (e) {
      return null;
    }
  })();
  const nativeReplace = (() => {
    try {
      return typeof location.replace === 'function' ? location.replace : null;
    } catch (e) {
      return null;
    }
  })();

  const patchLocation = (name, native) => {
    if (!native) return;
    try {
      Object.defineProperty(location, name, {
        configurable: true,
        writable: true,
        value: function (url) {
          try {
            if (url !== undefined && url !== null && isAdish(url)) return undefined;
          } catch (e) {}
          return native.apply(location, arguments);
        }
      });
      // If the browser refused the override, make sure navigation still works.
      if (location[name] === native) {
        Object.defineProperty(location, name, {
          configurable: true,
          writable: true,
          value: native
        });
      }
    } catch (e) {}
  };
  patchLocation('assign', nativeAssign);
  patchLocation('replace', nativeReplace);

  // Direct assignment to location.href (and bare `location = url`) navigates
  // the current tab without going through assign(): the clickunder path.
  // Chrome puts href as an OWN accessor on the location object (prototype has
  // no setter), so wrapping Location.prototype is a silent no-op there; try the
  // own descriptor first and fall back to the prototype for other engines.
  try {
    const hrefTarget = (() => {
      try {
        const own = Object.getOwnPropertyDescriptor(location, 'href');
        if (own && own.set) return { target: location, d: own };
      } catch (e) {}
      try {
        const proto =
          (window.Location && window.Location.prototype) ||
          (location.constructor && location.constructor.prototype);
        const pd = proto && Object.getOwnPropertyDescriptor(proto, 'href');
        if (pd && pd.set) return { target: proto, d: pd };
      } catch (e) {}
      return null;
    })();
    if (hrefTarget) {
      const nativeHrefSet = hrefTarget.d.set;
      Object.defineProperty(hrefTarget.target, 'href', {
        configurable: true,
        enumerable: hrefTarget.d.enumerable,
        get: hrefTarget.d.get,
        set: function (v) {
          try {
            if (typeof v === 'string' && isAdish(v)) return undefined;
          } catch (e) {}
          return nativeHrefSet.call(this, v);
        }
      });
    }
  } catch (e) {}

  // ---------------------------------------------------------- href navigation
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
    if (desc && desc.set && desc.get) {
      const nativeSet = desc.set;
      Object.defineProperty(HTMLAnchorElement.prototype, 'href', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          try {
            if (typeof v === 'string' && isAdish(v)) return;
          } catch (e) {}
          return nativeSet.call(this, v);
        }
      });
    }
  } catch (e) {}

  // -------------------------------------------------------------- DOM events
  // Never stopImmediatePropagation here: other listeners must keep running so
  // media players, SPA routers and lazy loaders behave normally.
  const veto = (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch (err) {}
  };

  // cancelable:false (synthetic MouseEvent) ignores preventDefault, so the
  // default action must be neutralized by dropping the href; restore it after
  // the navigation decision has been made.
  const vetoHard = (e, node) => {
    veto(e);
    if (!e.cancelable) {
      try {
        const hrefAttr = node.getAttribute('href');
        node.removeAttribute('href');
        setTimeout(() => {
          try { node.setAttribute('href', hrefAttr); } catch (err) {}
        }, 80);
      } catch (err) {}
    }
  };

  // A click is a new-tab attempt when the element asks for a popup target, or
  // when the gesture itself forces one (middle click, ctrl/cmd/shift click).
  // Matching only ad-looking hrefs was the leak: an ordinary https URL on
  // target=_blank opened a tab every time.
  const opensNewTab = (e, anchor) => {
    const target = (anchor.getAttribute('target') || '').toLowerCase();
    if (target && BLOCK_TARGETS.has(target)) return true;
    if (e.type === 'auxclick') return e.button === 1;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return true;
    return false;
  };

  const onClick = (e) => {
    let t;
    try {
      t = e.target;
    } catch (err) {
      return;
    }
    if (!t || t.nodeType !== 1) return;

    let node = t;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 12) {
      depth++;
      let tag = '';
      try {
        tag = String(node.tagName || '').toUpperCase();
      } catch (e) {}

      if (tag && MEDIA_TAGS.has(tag)) return;

      if (tag === 'A' || tag === 'AREA') {
        const href = node.getAttribute('href') || '';
        const lower = href.toLowerCase();
        if (lower.indexOf('javascript:') === 0) {
          if (
            lower.includes('window.open') ||
            lower.includes('location.href') ||
            lower.includes('location=')
          ) {
            vetoHard(e, node);
            return;
          }
        }
        if (opensNewTab(e, node)) {
          vetoHard(e, node);
          return;
        }
        if (isAdish(href)) {
          vetoHard(e, node);
          return;
        }
      }

      let oc = '';
      try {
        oc = (node.getAttribute && node.getAttribute('onclick')) || '';
      } catch (e2) {}
      if (oc) {
        oc = oc.toLowerCase();
        if (
          oc.includes('window.open') ||
          oc.includes('location.href=') ||
          oc.includes('location.assign') ||
          oc.includes('location.replace') ||
          oc.includes('.open(') ||
          oc.includes('open(url') ||
          oc.includes('open(window')
        ) {
          if (isMediaNode(node, 1)) return;
          veto(e);
          return;
        }
      }

      node = node.parentElement;
    }
  };

  // <form target="_blank"> bypasses the anchor rules entirely.
  const onSubmit = (e) => {
    let f;
    try {
      f = e.target;
    } catch (err) {
      return;
    }
    if (!f || f.nodeType !== 1 || f.tagName !== 'FORM') return;
    const target = (f.getAttribute('target') || '').toLowerCase();
    if (!target || !BLOCK_TARGETS.has(target)) return;
    if (isMediaEvent(f)) return;
    veto(e);
  };

  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  // mousedown is deliberately not intercepted: it would swallow right-click
  // context menus and text selection. click/auxclick already cover every
  // gesture that can spawn a tab.
  window.addEventListener('submit', onSubmit, true);

  // --------------------------------------------------------------- lifecycle
  const reseal = () => {
    try {
      if (window.open !== blockedOpen) sealOpen();
      const proto = window.Window && window.Window.prototype;
      if (proto && Object.getOwnPropertyDescriptor(proto, 'open')) {
        const cur = Object.getOwnPropertyDescriptor(proto, 'open');
        if (!(cur.get && cur.get.call(proto) === blockedOpen)) sealProtoOpen();
      }
      if (guardedClickRef && anchorProtoRef && anchorProtoRef.click !== guardedClickRef) {
        anchorProtoRef.click = guardedClickRef;
      }
      if (guardedSubmitRef && formProtoRef && formProtoRef.submit !== guardedSubmitRef) {
        formProtoRef.submit = guardedSubmitRef;
      }
      const svgG2 = svgRefs.guarded;
      if (svgG2 && svgRefs.proto && svgRefs.proto.click !== svgG2) {
        svgRefs.proto.click = svgG2;
      }
      const areaG2 = areaRefs.guarded;
      if (areaG2 && areaRefs.proto && areaRefs.proto.click !== areaG2) {
        areaRefs.proto.click = areaG2;
      }
    } catch (e) {}
  };

  window.addEventListener('pageshow', reseal, true);
  // Keep a slow heartbeat so a page that overwrites the guard on a timer can
  // never keep a new-tab path alive for long.
  setInterval(reseal, 4000);

  try {
    window.addEventListener('pagehide', () => clearInterval(sealTimer), { once: true });
  } catch (e) {}
})();
