const { JSDOM } = require('jsdom');
const path=require('path').resolve(__dirname,'..');
const API=JSON.parse(require('fs').readFileSync(__dirname+'/api.json','utf8'));
const dom=new JSDOM(require('fs').readFileSync(path+'/index.html','utf8'),{
  runScripts:'dangerously',resources:'usable',url:'file://'+path+'/index.html',pretendToBeVisual:true,
  beforeParse(w){ w.fetch=async(u,o)=>({json:async()=>API[JSON.parse(o.body).action]||{success:true}}); w.scrollTo=()=>{}; }});
const w=dom.window;
w.addEventListener('load',()=>setTimeout(async()=>{
  const $=s=>w.document.querySelector(s);
  const ok=(l,c,x='')=>console.log(`${c?'PASS':'*** FAIL ***'}  ${l}${x?'  '+x:''}`);
  w.eval("S.mgrKey='M1';");
  await w.eval("refreshManagerDashboard()");
  // manager starts typing a phone number
  const inp=$('#instapayNumInp'); inp.focus(); inp.value='0100';
  ok('input focused before refresh', w.document.activeElement===inp);
  await w.eval("refreshManagerDashboard()");   // simulate the 10s tick
  ok('focus SURVIVES auto-refresh', w.document.activeElement===$('#instapayNumInp'));
  ok('typed value survives', $('#instapayNumInp').value==='0100', $('#instapayNumInp').value);
  // when nothing focused, it must still re-render normally
  $('#instapayNumInp').blur(); w.document.body.focus();
  w.eval("S.paymentInfo.collectorName='سارة';");
  await w.eval("refreshManagerDashboard()");
  ok('re-renders when nothing focused', !!$('#collectorSel'));
  process.exit(0);
},400));
