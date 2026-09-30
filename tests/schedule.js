const { JSDOM } = require('jsdom');
const path = require('path').resolve(__dirname, '..');
const calls = [];
const API = {
  getAll: { success:true,
    menu:{ 'c':[{name:'shai',price:10}] }, names:['a','b'],
    orders:[], locked:false, lockTime:'', orderingOpen:false, ordersCount:0,
    restaurants:[{id:1,name:'k',delivery_fee:25}], activeRestaurantId:1, deliveryFee:25,
    noteSuggestions:{}, lastOrders:{},
    paymentInfo:{collectorName:'',paymentCash:false,paymentInstapay:false,instapayNumber:''},
    schedule:{ resetHour:18, resetMinute:30, autoOpenEnabled:false, openHour:6, openMinute:0, openCollectorName:'', openPayCash:false, openPayInstapay:false, openInstapayNumber:'' }
  },
  getStatus:{success:true,locked:false,lockTime:'',orderingOpen:false,ordersCount:0,activeRestaurantId:1,deliveryFee:25,paymentInfo:{collectorName:'',paymentCash:false,paymentInstapay:false,instapayNumber:''}},
  getOrders:{success:true,data:[]},
  getOrdersAdmin:{success:true,data:[]},
  getNamesAdmin:{success:true,data:[{name:'a',instapay_number:''},{name:'b',instapay_number:''}]},
  getMenuAdmin:{success:true,data:[]},
  getRestaurants:{success:true,data:[{id:1,name:'k',delivery_fee:25}]},
  verify:{success:true},
  saveSchedule:{success:true}
};
const errors = [];
const dom = new JSDOM(require('fs').readFileSync(path+'/index.html','utf8'), {
  runScripts:'dangerously', resources:'usable', url:'file://'+path+'/index.html', pretendToBeVisual:true,
  beforeParse(w){
    w.fetch = async (u,o)=>{ const b=JSON.parse(o.body); calls.push(b); return { json: async()=> (API[b.action]||{success:true}) }; };
    w.scrollTo=()=>{}; w.addEventListener('error',e=>errors.push(e.message));
  }
});
const w = dom.window;
w.addEventListener('load', ()=> setTimeout(async ()=>{
  const $=s=>w.document.querySelector(s);
  let pass=0,fail=0; const OK=(l,c,x)=>{ if(c)pass++; else fail++; console.log((c?'PASS':'*** FAIL ***')+'  '+l+(x?'  '+x:'')); };
  try{
    // enter manager dashboard directly
    w.eval("S.mgrKey='M1'; S.namesAdmin=[{name:'a',instapay_number:''},{name:'b',instapay_number:''}]; showScreen('screen-manager'); renderManagerDashboard();");
    await new Promise(r=>setTimeout(r,60));
    OK('schedule section rendered', !!$('#mgrScheduleSection .mgr-config-card'));
    OK('reset time prefilled from schedule (18:30)', $('#resetTime') && $('#resetTime').value==='18:30', $('#resetTime') && $('#resetTime').value);
    OK('auto-open box hidden when disabled', $('#autoOpenBox') && $('#autoOpenBox').style.display==='none');
    // enable auto-open
    const chk=$('#autoOpenChk'); chk.checked=true; chk.dispatchEvent(new w.Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,30));
    OK('auto-open box shows after toggle', $('#autoOpenBox').style.display!=='none', $('#autoOpenBox').style.display);
    // fill fields
    $('#openTime').value='06:15';
    const sel=$('#openCollectorSel'); sel.value='a'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
    $('#openCash').checked=true;
    // save
    calls.length=0;
    $('[data-action=doSaveSchedule]').click();
    await new Promise(r=>setTimeout(r,80));
    const saveCall = calls.find(c=>c.action==='saveSchedule');
    OK('saveSchedule called', !!saveCall, JSON.stringify(saveCall&&saveCall.data));
    const d = (saveCall&&saveCall.data)||{};
    OK('sends reset 18:30', d.resetHour===18 && d.resetMinute===30);
    OK('sends autoOpen true, open 06:15', d.autoOpenEnabled===true && d.openHour===6 && d.openMinute===15);
    OK('sends collector a + cash', d.openCollectorName==='a' && d.openPayCash===true);
    OK('no window errors', errors.length===0, errors.join('|'));
    console.log('\nPASS '+pass+'  FAIL '+fail);
    process.exit(fail?1:0);
  }catch(e){ console.log('HARNESS ERROR',(e&&e.stack)||e); process.exit(1);}
},300));
