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
