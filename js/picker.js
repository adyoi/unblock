(() => {
  if (window.__uboPickerActive) return;
  window.__uboPickerActive = true;
  const overlay = document.createElement('div');
  overlay.id = 'unblock-picker-overlay';
  const box = document.createElement('div');
  box.id = 'unblock-picker-box';
  const toolbar = document.createElement('div');
  toolbar.id = 'unblock-picker-toolbar';
  toolbar.innerHTML = `
    <span>Element picker</span>
    <button id="block-element">Block element</button>
    <button id="block-parent">Block parent</button>
    <button id="block-undo">Undo</button>
    <button id="block-cancel" class="close">Cancel</button>
    <button id="block-exit" class="danger">Exit</button>
  `;
  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(toolbar);
  let target = null, last = null, history = [];
  function getSelector(el) {
    if (!(el instanceof Element)) return null;
    if (el === document.body || el === document.documentElement) return null;
    if (el.id) { try { return '#' + CSS.escape(el.id); } catch (e) { return '#' + el.id; } }
    const parts = []; let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && depth < 5) {
      let tag = cur.tagName.toLowerCase();
      if (cur.classList && cur.classList.length) {
        const cls = Array.from(cur.classList).slice(0,2).map(c=>{try{return CSS.escape(c)}catch(e){return c}}).join('.');
        if (cls) tag += '.' + cls;
      }
      parts.unshift(tag); if (cur.id) break; cur = cur.parentElement; depth++;
    }
    if (parts.length === 0) return null; return parts.join(' > ');
  }
  function highlight(e) {
    const el = e.target; if (el === overlay || el === box || el === toolbar || toolbar.contains(el)) return;
    target = el; if (last === el) return; last = el;
    const r = el.getBoundingClientRect();
    box.style.top = r.top + 'px'; box.style.left = r.left + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    toolbar.style.top = Math.max(4, window.scrollY + r.top - 36) + 'px'; toolbar.style.left = Math.max(4, window.scrollX + r.left) + 'px';
  }
  function applyRule(sel, el) { if (!sel) return; try { el.classList.add('unblock-picked'); } catch (e) {} try { window.postMessage({ type: 'UNBLOCK_PICKED', selector: sel }, '*'); } catch (e) {} history.push({ el }); }
  function pick(e) { if (e && e.preventDefault) e.preventDefault(); if (e && e.stopPropagation) e.stopPropagation(); if (!target) return; const sel=getSelector(target); if (sel) applyRule(sel,target); cleanup(); }
  function blockParent(e) { if (e && e.stopPropagation) e.stopPropagation(); if (!target || !target.parentElement) return; const p=target.parentElement; const sel=getSelector(p); if (sel) applyRule(sel,p); target=p; highlight({target:p}); }
  function undo(e) { if (e && e.stopPropagation) e.stopPropagation(); const last=history.pop(); if (last && last.el) { try { last.el.classList.remove('unblock-picked'); } catch (e) {} } }
  function cleanup() { try { document.removeEventListener('mousemove', highlight, true); document.removeEventListener('click', pick, true); } catch (e) {} try { overlay.remove(); box.remove(); toolbar.remove(); } catch (e) {} window.__uboPickerActive = false; try { document.body.style.cursor=''; } catch (e) {} }
  try { document.body.style.cursor='crosshair'; } catch (e) {}
  document.addEventListener('mousemove', highlight, true); document.addEventListener('click', pick, true);
  const btnBlock = document.querySelector('#block-element');
  const btnParent = document.querySelector('#block-parent');
  const btnUndo = document.querySelector('#block-undo');
  const btnCancel = document.querySelector('#block-cancel');
  const btnExit = document.querySelector('#block-exit');
  if (btnBlock) btnBlock.onclick = (e) => { e.stopPropagation(); pick(e); };
  if (btnParent) btnParent.onclick = (e) => { e.stopPropagation(); blockParent(e); };
  if (btnUndo) btnUndo.onclick = (e) => { e.stopPropagation(); undo(e); };
  if (btnCancel) btnCancel.onclick = (e) => { e.stopPropagation(); cleanup(); };
  if (btnExit) btnExit.onclick = (e) => { e.stopPropagation(); cleanup(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cleanup(); }, { once: true });
})();
