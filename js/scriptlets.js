// Unblock - Scriptlets Engine (safe subset of uBlock Origin)
const SCRIPTLETS = {
  'no-adblocker': function () {
    try {
      const noop = () => {};
      const props = ['adBlock','ads','adGuard','uBlock','uBlockOrigin','blockAdBlock','FuckAdBlock','unBlockAdBlock','adblockDetector'];
      for (let i=0; i<props.length; i++){
        try{ Object.defineProperty(window, props[i], {get:noop,set:noop,configurable:true}); } catch(e){}
        try{ window[props[i]] = noop; } catch(e){}
      }
      const fn = ['check','detect','isAdblock','isAdBlocking','hasAdblock'];
      const objs = [window,document,navigator];
      for (let k=0; k<objs.length; k++){
        const o = objs[k]; if(!o) continue;
        for (let f=0; f<fn.length; f++){
          try{ if(typeof o[fn[f]] === 'function') o[fn[f]] = noop; } catch(e){}
        }
      }
    } catch(e){}
  },
  'prevent-popads-net': function(){
    try{
      const orig = window.open;
      window.open = function(url){
        if(!url) return orig.apply(window,arguments);
        try{
          const s = String(url).toLowerCase();
          if(s.includes('popads')||s.includes('adclick')||s.includes('doubleclick')||s.includes('googlesyndication')||s.includes('ads.')||s.includes('adnxs')||s.includes('taboola')||s.includes('outbrain')||s.includes('clickadu')||s.includes('propeller')||s.includes('exoclick')) return null;
        }catch(e){}
        return orig.apply(window,arguments);
      };
    }catch(e){}
  },
  'prevent-window-open': function(){
    try{
      const orig = window.open;
      window.open = function(){ return null; };
    }catch(e){}
  },
  // Safe subset of uBO's abort-current-script: redefine a (possibly nested)
  // property so that reading it throws, which stops the offending script.
  'abort-current-script': function(prop){
    try{
      if(typeof prop !== 'string' || !prop) return;
      const parts = prop.split('.');
      let owner = window;
      for(let i=0; i<parts.length-1; i++){
        owner = owner[parts[i]];
        if(!owner) return;
      }
      const last = parts[parts.length-1];
      if(!last) return;
      try{
        Object.defineProperty(owner, last, {
          get: function(){ throw new ReferenceError('unblock: aborted ' + prop); },
          set: function(){},
          configurable: true
        });
      }catch(e){}
    }catch(e){}
  },
  // Safe subset of uBO's remove-class: strip a class from matching elements and
  // keep stripping it as the page re-adds it.
  'remove-class': function(cls, sel){
    try{
      if(typeof cls !== 'string' || !cls) return;
      let esc = cls;
      try{ if(typeof CSS !== 'undefined' && CSS.escape) esc = CSS.escape(cls); }catch(e){}
      const selector = (typeof sel === 'string' && sel) ? sel : '.' + esc;
      const strip = function(root){
        try{
          const scope = root && root.querySelectorAll ? root : document;
          const nodes = scope.querySelectorAll(selector);
          for(let i=0; i<nodes.length; i++){
            try{ if(nodes[i] && nodes[i].classList) nodes[i].classList.remove(cls); }catch(e){}
          }
        }catch(e){}
      };
      strip();
      if(typeof MutationObserver === 'function' && (document.documentElement || document.body)){
        const mo = new MutationObserver(function(){ strip(); });
        mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
      }
    }catch(e){}
  }
};
function runScriptlets(list){
  if(!Array.isArray(list) || list.length===0) return;
  for(let i=0; i<list.length; i++){
    const s = list[i];
    try{
      if(typeof s==='string'){
        if(s==='no-adblocker') SCRIPTLETS['no-adblocker']();
        if(s==='prevent-window-open') SCRIPTLETS['prevent-window-open']();
        continue;
      }
      if(s && s.name && SCRIPTLETS[s.name]) SCRIPTLETS[s.name].apply(null, s.args||[]);
    }catch(e){}
  }
}
window.__uboScriptlets = {run: runScriptlets, registry: SCRIPTLETS};
