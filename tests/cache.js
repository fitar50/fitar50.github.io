const { JSDOM } = require('jsdom');
const path=require('path').resolve(__dirname,'..');
const API=JSON.parse(require('fs').readFileSync(__dirname+'/api.json','utf8'));
const ok=(l,c,x='')=>console.log(`${c?'PASS':'*** FAIL ***'}  ${l}${x?'  '+x:''}`);
const regs=[]; let updateCalls=0;
const dom=new JSDOM(require('fs').readFileSync(path+'/index.html','utf8'),{
  runScripts:'dangerously',resources:'usable',url:'https://x.github.io/index.html',pretendToBeVisual:true,
  beforeParse(w){
    w.fetch=async(u,o)=>({json:async()=>API[JSON.parse(o.body).action]||{success:true}});
    w.scrollTo=()=>{};
    const listeners={};
    Object.defineProperty(w.navigator,'serviceWorker',{configurable:true,value:{
      controller:null,
      register:async u=>{regs.push(u); return {update:()=>{updateCalls++;}, addEventListener:()=>{}};},
      addEventListener:(t,f)=>{(listeners[t]=listeners[t]||[]).push(f);},
      _fire:t=>(listeners[t]||[]).forEach(f=>f())
    }});
    w.__listeners=listeners;
  }});
const w=dom.window;
w.addEventListener('load',()=>setTimeout(()=>{
  const d=w.document;
  ok('manifest linked', !!d.querySelector('link[rel="manifest"]'));
  ok('theme-color set', !!d.querySelector('meta[name="theme-color"]'));
  ok('apple touch icon', !!d.querySelector('link[rel="apple-touch-icon"]'));
  ok('service worker REGISTERED', regs.length===1, regs.join(','));
  ok('update() called on load', updateCalls===1);
  const scripts=[...d.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'));
  ok('every script versioned', scripts.every(s=>s.includes('?v=')), scripts.length+' scripts');
  const css=[...d.querySelectorAll('link[rel=stylesheet]')].map(l=>l.getAttribute('href'));
  ok('every stylesheet versioned', css.every(c=>c.includes('?v=')), css.join(','));
  // controllerchange must NOT reload on first-ever install
  // controller was null at parse time, so _hadController is false and the
  // handler must bail out before ever touching location.reload
  ok('_hadController captured as false', w.eval('_hadController')===false);
  w.navigator.serviceWorker._fire('controllerchange');
  ok('no reload loop on first install (handler bailed)', w.eval('_reloading')===false);
  process.exit(0);
},400));
