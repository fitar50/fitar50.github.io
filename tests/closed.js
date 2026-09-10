const { JSDOM } = require('jsdom');
const path=require('path').resolve(__dirname,'..');
let API=JSON.parse(require('fs').readFileSync(__dirname+'/api.json','utf8'));
const ok=(l,c,x='')=>console.log(`${c?'PASS':'*** FAIL ***'}  ${l}${x?'  '+x:''}`);
const dom=new JSDOM(require('fs').readFileSync(path+'/index.html','utf8'),{
  runScripts:'dangerously',resources:'usable',url:'file://'+path+'/index.html',pretendToBeVisual:true,
  beforeParse(w){ w.fetch=async(u,o)=>({json:async()=>API[JSON.parse(o.body).action]||{success:true}}); w.scrollTo=()=>{}; }});
const w=dom.window;
w.addEventListener('load',()=>setTimeout(async()=>{
  const $=s=>w.document.querySelector(s);
  const active=()=>{const a=$('.screen.active');return a?a.id:null;};
  // MANAGER LOCKS
  API.getStatus={...API.getStatus, locked:true, lockTime:'09:30'};
  w.eval("S.currentName='سارة'; startUserPoll();");
  await new Promise(r=>setTimeout(r,11000));
  ok('lock -> closed screen', active()==='screen-closed', active());
  await new Promise(r=>setTimeout(r,600));
  ok('closed screen shows payment box', $('#closedPaymentBox').innerHTML.includes('أحمد'),
     $('#closedPaymentBox').textContent.trim().slice(0,40));

  // MANAGER CHANGES COLLECTOR AFTER LOCK (money changes hands now)
  API.getStatus={...API.getStatus, paymentInfo:{collectorName:'مروان',paymentCash:true,
    paymentInstapay:true,instapayNumber:'01099998888'}};
  await new Promise(r=>setTimeout(r,11000));
  ok('collector change REACHES closed screen', $('#closedPaymentBox').innerHTML.includes('مروان'),
     $('#closedPaymentBox').textContent.trim().slice(0,40));
  ok('new instapay number shown', $('#closedPaymentBox').innerHTML.includes('01099998888'));

  // MANAGER RESETS THE DAY
  API.getStatus={...API.getStatus, locked:false, lockTime:'', orderingOpen:false, ordersCount:0};
  API.getOrders={success:true,data:[]};
  await new Promise(r=>setTimeout(r,11000));
  ok('reset detected on closed screen', active()==='screen-not-open', active());
  ok('local lock state cleared', w.eval('S.isLocked')===false);
  process.exit(0);
},400));
