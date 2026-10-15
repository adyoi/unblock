(() => {
  if (window.__uboPickerActive) return;
  window.__uboPickerActive = true;
  const overlay = document.createElement('div');
  overlay.id = 'unblock-picker-overlay';
  const box = document.createElement('div');
  box.id = 'unblock-picker-box';
  const toolbar = document.createElement('div');
  toolbar.id = 'unblock-picker-toolbar';
  const label = document.createElement('span'); label.textContent = 'Element picker';
  const btnElement = document.createElement('button'); btnElement.id = 'block-element'; btnElement.textContent = 'Block element';
  const btnParent = document.createElement('button'); btnParent.id = 'block-parent'; btnParent.textContent = 'Block parent';
  const btnSimilar = document.createElement('button'); btnSimilar.id = 'block-similar'; btnSimilar.textContent = 'Block similar';
  const btnUndo = document.createElement('button'); btnUndo.id = 'block-undo'; btnUndo.textContent = 'Undo';
  const btnCancel = document.createElement('button'); btnCancel.id = 'block-cancel'; btnCancel.className = 'close'; btnCancel.textContent = 'Cancel';
  const btnExit = document.createElement('button'); btnExit.id = 'block-exit'; btnExit.className = 'danger'; btnExit.textContent = 'Exit';
  toolbar.appendChild(label);
  toolbar.appendChild(btnElement);
  toolbar.appendChild(btnParent);
  toolbar.appendChild(btnSimilar);
  toolbar.appendChild(btnUndo);
  toolbar.appendChild(btnCancel);
  toolbar.appendChild(btnExit);
  function ensureMounted() {
    if (toolbar.isConnected) return;
    try {
      const root = document.documentElement || document.body;
      if (!root) return;
      if (!overlay.isConnected) root.appendChild(overlay);
      if (!box.isConnected) root.appendChild(box);
      if (!toolbar.isConnected) root.appendChild(toolbar);
    } catch (e) {}
  }
  ensureMounted();
  let target = null, last = null, locked = null, history = [], pageSelectors = [], marked = [];
  function getSelector(el) {
    if (!(el instanceof Element)) return null;
    if (el === document.body || el === document.documentElement) return null;
    function unique(sel) {
      if (!sel) return null;
      try {
        const n = document.querySelectorAll(sel);
        if (n.length === 1) return sel;
        let cur = el;
        let idx = 0;
        while (cur) {
          if (cur.parentElement) {
            const sibs = Array.prototype.slice.call(cur.parentElement.children).filter(x => x.tagName === cur.tagName);
            if (sibs.length > 1) { idx = sibs.indexOf(cur) + 1; break; }
          }
          cur = cur.parentElement;
        }
        if (idx) { const nth = sel + ':nth-of-type(' + idx + ')'; try { if (document.querySelectorAll(nth).length === 1) return nth; } catch (e) {} }
        cur = el;
        idx = 0;
        while (cur) {
          if (cur.parentElement) {
            const sibs = Array.prototype.slice.call(cur.parentElement.children);
            if (sibs.length > 1) { idx = sibs.indexOf(cur) + 1; break; }
          }
          cur = cur.parentElement;
        }
        if (idx) { const nth = sel + ':nth-child(' + idx + ')'; try { if (document.querySelectorAll(nth).length === 1) return nth; } catch (e) {} }
      } catch (e) {}
      return sel;
    }
    if (el.id) { try { return unique('#' + CSS.escape(el.id)); } catch (e) { return unique('#' + el.id); } }
    const parts = []; let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && depth < 6) {
      let tag = cur.tagName.toLowerCase();
      if (cur.classList && cur.classList.length) {
        const cls = Array.from(cur.classList).filter(c => !(c.indexOf('unblock-') === 0)).slice(0,2).map(c=>{try{return CSS.escape(c)}catch(e){return c}}).join('.');
        if (cls) tag += '.' + cls;
      }
      parts.unshift(tag); if (cur.id) break; cur = cur.parentElement; depth++;
    }
    if (parts.length === 0) return null; return unique(parts.join(' > '));
  }
  function escClass(c) { try { return CSS.escape(c); } catch (e) { return c; } }
  function similarSelector(el) {
    if (!(el instanceof Element) || !el.parentElement) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') return null;
    const classes = el.classList ? Array.from(el.classList).filter((c) => c.indexOf('unblock-') !== 0) : [];
    for (let n = classes.length; n >= 0; n--) {
      const sel = tag + classes.slice(0, n).map((c) => '.' + escClass(c)).join('');
      let total = 0;
      try { total = document.querySelectorAll(sel).length; } catch (e) { continue; }
      if (total >= 2 && total <= 50) return sel;
    }
    return null;
  }
  function placeToolbar(el) {
    if (!el) return;
    ensureMounted();
    const r = el.getBoundingClientRect();
    toolbar.style.display = 'flex';
    const w = toolbar.offsetWidth || 260;
    const h = toolbar.offsetHeight || 34;
    let top = r.top - h - 6;
    if (top < 4) top = r.bottom + 6;
    if (top + h > window.innerHeight - 4) top = Math.max(4, window.innerHeight - h - 4);
    let left = r.left;
    if (left + w > window.innerWidth - 4) left = window.innerWidth - w - 4;
    if (left < 4) left = 4;
    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
  }
  function highlight(e) {
    if (locked) return;
    const el = e.target; if (!el || el.nodeType !== 1) return; if (el === overlay || el === box || el === toolbar || toolbar.contains(el)) return;
    ensureMounted();
    target = el; if (last === el) return; last = el;
    const r = el.getBoundingClientRect();
    box.style.top = r.top + 'px'; box.style.left = r.left + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  }
  function applyCursor() { try { document.body.style.cursor = locked ? '' : 'crosshair'; } catch (e) {} }
  function lock(e) {
    if (e && e.target && (e.target === toolbar || toolbar.contains(e.target))) return;
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    const el = e && e.target && e.target.nodeType === 1 ? e.target : target;
    if (!el || el === overlay || el === box) return;
    if (locked === el) { releaseLock(); return; }
    if (locked) { try { locked.classList.remove('unblock-locked'); } catch (err) {} }
    locked = el;
    try { el.classList.add('unblock-locked'); } catch (err) {}
    try { box.style.display = 'none'; } catch (err) {}
    applyCursor();
    placeToolbar(locked);
  }
  function applySimilar(sel, els) { if (!sel || !els || !els.length) return; for (let i = 0; i < els.length; i++) { try { els[i].classList.add('unblock-picked'); } catch (e) {} } history.push({ els: els.slice(), sel: sel }); try { window.postMessage({ type: 'UNBLOCK_PICKED', selector: sel }, '*'); } catch (e) {} }
  function applyRule(sel, el) { if (!sel || !el) return; applySimilar(sel, [el]); }
  function releaseLock() { if (locked) { try { locked.classList.remove('unblock-locked'); } catch (e) {} } locked = null; try { box.style.display = ''; } catch (e) {} applyCursor(); }
  function markUnblocked(el) {
    if (!el) return;
    try { el.classList.remove('unblock-picked'); el.classList.remove('unblock-blocked'); el.classList.remove('unblock-locked'); el.classList.add('unblock-unblocked'); } catch (e) {}
    marked.push(el);
  }
  function blockElement(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const el = locked || target; if (!el) return;
    const sel = getSelector(el); if (sel) applyRule(sel, el);
    releaseLock(); toolbar.style.display = 'none';
  }
  function blockParent(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const el = locked || target; if (!el || !el.parentElement) return;
    const p = el.parentElement; const sel = getSelector(p); if (sel) applyRule(sel, p);
    releaseLock(); locked = p; target = p;
    try { p.classList.add('unblock-locked'); } catch (err) {}
    try { box.style.display = 'none'; } catch (err) {}
    applyCursor();
    placeToolbar(p);
  }
  function blockSimilar(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const el = locked || target; if (!el) return;
    const sel = similarSelector(el) || getSelector(el);
    if (sel) {
      let els = [];
      try { els = Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (err) { els = [el]; }
      if (!els.length) els = [el];
      applySimilar(sel, els);
    }
    releaseLock(); toolbar.style.display = 'none';
  }
  function undo(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const u = history.pop();
    if (u && u.els && u.els.length) {
      for (let i = 0; i < u.els.length; i++) markUnblocked(u.els[i]);
      try { window.postMessage({ type: 'UNBLOCK_UNPICK', selector: u.sel }, '*'); } catch (err) {}
      releaseLock(); toolbar.style.display = 'none';
      return;
    }
    const el = locked || target; if (!el) return;
    let removed = false;
    for (let i = 0; i < pageSelectors.length; i++) {
      const s = pageSelectors[i];
      let hit = false;
      try { hit = el.matches(s); } catch (err) { hit = false; }
      if (!hit) continue;
      removed = true;
      try { window.postMessage({ type: 'UNBLOCK_UNPICK', selector: s }, '*'); } catch (err) {}
    }
    if (removed) { markUnblocked(el); releaseLock(); toolbar.style.display = 'none'; }
  }
  function cleanup() {
    try { window.removeEventListener('mousemove', highlight, true); window.removeEventListener('click', lock, true); } catch (e) {}
    for (let i = 0; i < history.length; i++) {
      const els = history[i].els || [];
      for (let j = 0; j < els.length; j++) { try { els[j].classList.remove('unblock-picked'); } catch (e) {} }
    }
    for (let i = 0; i < marked.length; i++) { try { marked[i].classList.remove('unblock-unblocked'); } catch (e) {} }
    releaseLock();
    try { overlay.remove(); box.remove(); toolbar.remove(); } catch (e) {}
    try { window.postMessage({ type: 'UNBLOCK_PICKER_END' }, '*'); } catch (e) {}
    window.__uboPickerActive = false;
    try { document.body.style.cursor = ''; } catch (e) {}
  }
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data) return;
    if (ev.data.type === 'UNBLOCK_RULESET' && Array.isArray(ev.data.selectors)) {
      pageSelectors = ev.data.selectors.filter((s) => typeof s === 'string');
      return;
    }
    if (ev.data.type === 'UNBLOCK_PICKER_STOP') { cleanup(); }
  });
  applyCursor();
  window.addEventListener('mousemove', highlight, true);
  window.addEventListener('click', lock, true);
  btnElement.onclick = (e) => { e.stopPropagation(); blockElement(e); };
  btnParent.onclick = (e) => { e.stopPropagation(); blockParent(e); };
  btnSimilar.onclick = (e) => { e.stopPropagation(); blockSimilar(e); };
  btnUndo.onclick = (e) => { e.stopPropagation(); undo(e); };
  btnCancel.onclick = (e) => { e.stopPropagation(); cleanup(); };
  btnExit.onclick = (e) => { e.stopPropagation(); cleanup(); };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); cleanup(); } }, { once: true, capture: true });
})();
