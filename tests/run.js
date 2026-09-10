const { JSDOM } = require('jsdom');
const path = require('path').resolve(__dirname,'..');

const API = {
  getAll: {
    success:true,
    menu:{ 'مشروبات ساخنة':[{name:'شاي',price:10}], 'ساندوتشات':[{name:'ساندوتش بطاطس',price:20}] },
    names:['أحمد','سارة'],
    orders:[{name:'سارة',items:[{name:'شاي',qty:2,price:10}],orderedBy:'سارة'}],
    locked:false, lockTime:'', orderingOpen:true, ordersCount:1,
    restaurants:[{id:1,name:'كشري',delivery_fee:25}], activeRestaurantId:1,
    deliveryFee:25,
    noteSuggestions:{ 'ساندوتش بطاطس':['كاتشب بس','بدون مايونيز'] },
    paymentInfo:{collectorName:'أحمد',paymentCash:true,paymentInstapay:true,instapayNumber:'01012345678'}
  },
  getStatus:{success:true,locked:false,lockTime:'',orderingOpen:true,ordersCount:1,
    activeRestaurantId:1,deliveryFee:25,deliveryOverride:'',
    paymentInfo:{collectorName:'أحمد',paymentCash:true,paymentInstapay:true,instapayNumber:'01012345678'}},
  getOrders:{success:true,data:[{name:'سارة',items:[{name:'شاي',qty:2,price:10}],orderedBy:'سارة'}]},
  getOrdersAdmin:{success:true,data:[
    {name:'سارة',items:[{name:'شاي',qty:2,price:10}],orderedBy:'سارة',paid:false},
    {name:'أحمد',items:[{name:'ساندوتش بطاطس',qty:1,price:20,note:'كاتشب بس'}],orderedBy:'أحمد',paid:true}]},
  getNames:{success:true,data:['أحمد','سارة']},
  getNamesAdmin:{success:true,data:[{name:'أحمد',instapay_number:'01012345678'},{name:'سارة',instapay_number:''}]},
  getRestaurants:{success:true,data:[{id:1,name:'كشري',delivery_fee:25}]},
  getMenu:{success:true,data:{'ساندوتشات':[{name:'ساندوتش بطاطس',price:20}]}},
  getMenuAdmin:{success:true,data:[{id:1,name:'كشري',delivery_fee:25,
    items:[{id:7,restaurant_id:1,category:'مشروبات ساخنة',name:'شاي',price:10,sort_order:1},
           {id:8,restaurant_id:1,category:'ساندوتشات',name:'ساندوتش بطاطس',price:20,sort_order:1}],
    noteSuggestions:[{id:3,item_name:'ساندوتش بطاطس',note:'كاتشب بس'}]}]},
  verify:{success:true}, verifySuperMgr:{success:true},
  setPaid:{success:true}, setPaymentInfo:{success:true}, setDeliveryOverride:{success:true}
};

const errors = [];
const dom = new JSDOM(require('fs').readFileSync(path+'/index.html','utf8'), {
  runScripts:'dangerously', resources:'usable', url:'file://'+path+'/index.html',
  pretendToBeVisual:true,
  beforeParse(w){
    w.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const r = API[body.action] || {success:true};
      return { json: async () => r };
    };
    w.scrollTo = ()=>{};
    w.addEventListener('error', e => errors.push('window.onerror: '+e.message));
  }
});
const w = dom.window;
w.addEventListener('load', () => setTimeout(async () => {
  const $ = s => w.document.querySelector(s);
  const active = () => { const a=$('.screen.active'); return a?a.id:null; };
  const ok=(l,c,x='')=>console.log(`${c?'PASS':'*** FAIL ***'}  ${l}${x?'  '+x:''}`);
  const click = sel => { const e=$(sel); if(!e) return false; e.click(); return true; };
  try{
    ok('init -> name screen', active()==='screen-name', active());
    ok('S.deliveryFee from server', w.eval('S').deliveryFee===25, String(w.eval('S').deliveryFee));
    ok('noteSuggestions loaded', Object.keys(w.eval('S').noteSuggestions).length===1);
    ok('name select full width (pencil gone)', !$('#editNameBtn'));
    ok('counter rendered', $('#orderCounter').textContent.includes('طلب 1 من 2'), $('#orderCounter').textContent);

    // order screen
    $('#nameSelect').value='أحمد'; click('[data-action="proceedWithName"]');
    await new Promise(r=>setTimeout(r,120));
    ok('-> order screen', active()==='screen-order', active());

    // find ساندوتش بطاطس flat id
    const fi = w.eval('S').menuFlat.find(i=>i.name==='ساندوتش بطاطس');
    ok('menuFlat built', !!fi);
    click(`[data-action="qty"][data-id="${fi.id}"][data-delta="+1"]`);
    ok('qty increments', w.eval('S').currentQty['ساندوتش بطاطس']===1);
    ok('total uses server price', $('#orderTotal').textContent.includes('20'), $('#orderTotal').textContent);

    // NOTE CHIPS
    click(`[data-action="toggleNote"][data-id="${fi.id}"]`);
    const chips = w.document.querySelectorAll(`#nchips-${fi.id} .note-chip`);
    ok('note chips rendered', chips.length===2, 'count='+chips.length);
    chips[0].click();
    ok('chip fills input', $(`#ninput-${fi.id}`).value==='كاتشب بس', $(`#ninput-${fi.id}`).value);
    ok('chip sets S.currentNotes', w.eval('S').currentNotes['ساندوتش بطاطس']==='كاتشب بس');
    ok('chip marked selected', chips[0].classList.contains('selected'));
    // item with no suggestions has no chip row
    const tea = w.eval('S').menuFlat.find(i=>i.name==='شاي');
    ok('no chips when no suggestions', !w.document.getElementById(`nchips-${tea.id}`));
    // qty->0 clears chip selection
    click(`[data-action="qty"][data-id="${fi.id}"][data-delta="-1"]`);
    ok('qty 0 clears chip selection', !chips[0].classList.contains('selected'));

    // MANAGER
    click('[data-action="showMgrLogin"]');
    await new Promise(r=>setTimeout(r,200));
    $('#mgrCodeInput').value='M1'; click('[data-action="doManagerLogin"]');
    await new Promise(r=>setTimeout(r,250));
    ok('-> manager screen', active()==='screen-manager', active());
    ok('collector dropdown exists', !!$('#collectorSel'));
    ok('collector preselected from server', $('#collectorSel').value==='أحمد', $('#collectorSel').value);
    ok('instapay prefilled', $('#instapayNumInp').value==='01012345678');
    ok('other-person option present', !!$('#collectorSel option[value="__other__"]'));
    ok('fee override input exists', !!$('#feeOverrideInp'));
    ok('restaurant select DISABLED (orders exist)', $('#restaurantSel').disabled);
    ok('paid summary rendered', $('#paidSummary').innerHTML.includes('دفع 1 من 2'), $('#paidSummary').textContent.trim());
    ok('paid toggle buttons present', w.document.querySelectorAll('[data-action="togglePaid"]').length===2);
    ok('paid card has is-paid class', !!$('.order-card.is-paid'));
    ok('delivery uses 25 not 30', $('#totalSummary').innerHTML.includes('25'));
    // collector -> other
    $('#collectorSel').value='__other__';
    $('#collectorSel').dispatchEvent(new w.Event('change',{bubbles:true}));
    ok('other reveals name input', $('#collectorOtherWrap').style.display!=='none');

    // SUPER MANAGER
    click('[data-action="showSuperMgrFromMgr"]');
    await new Promise(r=>setTimeout(r,200));
    $('#superMgrCodeInput').value='S1'; click('[data-action="doSuperMgrLogin"]');
    await new Promise(r=>setTimeout(r,250));
    ok('-> supermgr screen', active()==='screen-supermgr', active());
    const allCat = w.document.querySelectorAll('[data-cat="مشروبات ساخنة"]');
    console.log('  DEBUG matches:', [...allCat].map(e=>e.tagName+'#'+(e.id||'(noid)')+'.'+e.className.split(' ')[0]).join(' | '));
    const spaceCat = w.document.querySelector('.sm-cat-block[data-cat="مشروبات ساخنة"]');
    ok('category with SPACE renders', !!spaceCat);
    const uid = spaceCat.id.replace('smcat-','');
    ok('id is index-based, no space', !spaceCat.id.includes(' '), spaceCat.id);
    ok('add-item input findable by uid', !!w.document.getElementById(`smadditm-name-${uid}`));
    ok('fee input present', !!$('#smfee-1'));
    ok('note pill present', w.document.querySelectorAll('.sm-note-pill').length===1);
    // toggle category open/close tracking
    await new Promise(r=>setTimeout(r,200));
    spaceCat.querySelector('[data-action="smToggleCat"]').click();
    ok('cat toggle tracked', w.document.querySelector('.sm-cat-block[data-cat="مشروبات ساخنة"]').classList.contains('open'));
    ok('_smOpenCats key stored', w.eval("_smOpenCats.has('1::مشروبات ساخنة')"));
    // category rename show/hide cycle (inline-style vs class bug)
    const renameBtn = w.document.querySelector('[data-action="smRenameCategory"][data-cat="مشروبات ساخنة"]');
    await new Promise(r=>setTimeout(r,200));
    renameBtn.click();
    const rrow = w.document.getElementById(`smcatrename-${uid}`);
    ok('cat rename row opens', rrow.classList.contains('show'));
    await new Promise(r=>setTimeout(r,200));
    rrow.querySelector('[data-action="smCancelRename"]').click();
    await new Promise(r=>setTimeout(r,200));
    renameBtn.click();
    const stillWorks = rrow.classList.contains('show') && rrow.style.display !== 'none';
    ok('cat rename REOPENS after cancel', stillWorks,
       `class=${rrow.className} inline=${rrow.style.display||'(none set)'}`);

    // restaurant rename row uses INLINE display; verify its cycle too
    const rb = w.document.querySelector('[data-action="smRenameRestaurant"][data-id="1"]');
    await new Promise(r=>setTimeout(r,200));
    rb.click(); await new Promise(r=>setTimeout(r,200));
    const rrow2 = w.document.getElementById('smrename-1');
    ok('rest rename opens', rrow2.style.display==='flex', rrow2.style.display);
    rrow2.querySelector('[data-action="smCancelRename"]').click();
    await new Promise(r=>setTimeout(r,200));
    ok('rest rename closes', rrow2.style.display==='none');
    rb.click(); await new Promise(r=>setTimeout(r,200));
    ok('rest rename REOPENS', rrow2.style.display==='flex', rrow2.style.display);

    // payment box builder
    ok('_buildPaymentBox renders collector', w.eval('_buildPaymentBox()').includes('أحمد'));
    ok('_buildPaymentBox renders LTR number', w.eval('_buildPaymentBox()').includes('dir="ltr"'));
    ok('_buildPaymentBox empty when no collector',
       w.eval("(function(){const o=S.paymentInfo;S.paymentInfo={collectorName:'',paymentCash:false,paymentInstapay:false,instapayNumber:''};const r=_buildPaymentBox();S.paymentInfo=o;return r;})()")==='');

    // Bug 9.5: delivery split sums EXACTLY to the fee (no piaster lost)
    ok('deliverySplit 25/3 sums to exactly 25',
       Math.round(w.eval('deliverySplit(25,3).reduce((a,b)=>a+b,0)')*100)===2500,
       w.eval('JSON.stringify(deliverySplit(25,3))'));
    ok('deliverySplit 25/3 hands the extra piaster to the first person',
       w.eval('JSON.stringify(deliverySplit(25,3))')==='[8.34,8.33,8.33]',
       w.eval('JSON.stringify(deliverySplit(25,3))'));
    ok('deliverySplit divides evenly when it can',
       w.eval('JSON.stringify(deliverySplit(30,3))')==='[10,10,10]',
       w.eval('JSON.stringify(deliverySplit(30,3))'));
    ok('deliverySplit one person gets the whole fee', w.eval('deliverySplit(25,1)[0]')===25);
    ok('deliverySplit zero fee is all zeros', w.eval('deliverySplit(0,3).every(x=>x===0)')===true);

    console.log('\nJS ERRORS:', errors.length? errors : 'none');
    process.exit(0);
  }catch(e){ console.error('HARNESS:',e); console.log('JS ERRORS:',errors); process.exit(1); }
}, 300));
