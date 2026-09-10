// rounding.js — per-person rounding (js/config.js ROUNDING_STEP / ROUND_DOWN_SLACK,
// js/utils.js roundPersonTotal) plus the invariant that no rounded figure ever
// reaches the restaurant text.
const { JSDOM } = require('jsdom');
const path = require('path').resolve(__dirname, '..');
const API = JSON.parse(require('fs').readFileSync(__dirname + '/api.json', 'utf8'));
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${l}${x ? '  ' + x : ''}`); };

const dom = new JSDOM(require('fs').readFileSync(path + '/index.html', 'utf8'), {
  runScripts: 'dangerously', resources: 'usable', url: 'file://' + path + '/index.html',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = async (u, o) => ({ json: async () => API[JSON.parse(o.body).action] || { success: true } });
    w.scrollTo = () => {};
    Object.defineProperty(w.navigator, 'serviceWorker', { configurable: true, value: {
      controller: null, register: async () => ({ update: () => {}, addEventListener: () => {} }),
      addEventListener: () => {}
    }});
  }
});
const w = dom.window;

w.addEventListener('load', () => setTimeout(() => {
  try {
    const R = a => w.eval(`roundPersonTotal(${a})`);

    // ── Config constants present ──
    ok('ROUNDING_STEP is 5', w.eval('ROUNDING_STEP') === 5, String(w.eval('ROUNDING_STEP')));
    ok('ROUND_DOWN_SLACK is 1.5', w.eval('ROUND_DOWN_SLACK') === 1.5, String(w.eval('ROUND_DOWN_SLACK')));

    // ── The rule (the two examples the owner gave, plus the boundaries) ──
    ok('26 -> 25 (barely over, rounds down)', R(26) === 25, String(R(26)));
    ok('27 -> 30 (2 over, rounds up)',        R(27) === 30, String(R(27)));
    ok('25 -> 25 (exact multiple)',           R(25) === 25);
    ok('30 -> 30 (exact multiple)',           R(30) === 30);
    ok('28 -> 30',                            R(28) === 30);
    ok('31 -> 30 (1 over, rounds down)',      R(31) === 30);
    ok('26.5 -> 25 (exactly at the slack, rounds down)', R(26.5) === 25, String(R(26.5)));
    ok('26.51 -> 30 (just past the slack, rounds up)',   R(26.51) === 30, String(R(26.51)));
    ok('28.34 -> 30 (fractional total from a delivery split)', R(28.34) === 30, String(R(28.34)));

    // ── Guards ──
    ok('1 -> 5 (a real debt never rounds to 0)', R(1) === 5, String(R(1)));
    ok('3 -> 5 (a real debt never rounds to 0)', R(3) === 5, String(R(3)));
    ok('0 -> 0 (nothing owed stays nothing)',    R(0) === 0);
    ok('negative passes through untouched',      R(-4) === -4, String(R(-4)));

    // ── Integration with deliverySplit: exact shares, then rounding on top ──
    const scenario = w.eval(`(function(){
      const orders=[
        {name:'أحمد',items:[{name:'شاي',qty:1,price:10}]},
        {name:'سارة',items:[{name:'قهوة',qty:1,price:12}]},
        {name:'محمد',items:[{name:'فول',qty:2,price:8}]}
      ];
      const fee=25, people=orders.length;
      const shares=deliverySplit(fee,people);
      const rounded=orders.map((o,i)=>roundPersonTotal(o.items.reduce((s,x)=>s+x.price*x.qty,0)+shares[i]));
      const bill=orders.reduce((s,o)=>s+o.items.reduce((a,x)=>a+x.price*x.qty,0),0)+fee;
      const collected=rounded.reduce((a,b)=>a+b,0);
      return JSON.stringify({shares,rounded,bill,collected,surplus:collected-bill});
    })()`);
    const S1 = JSON.parse(scenario);
    ok('delivery shares still sum EXACTLY to the fee (9.5 kept)',
       Math.round(S1.shares.reduce((a, b) => a + b, 0) * 100) === 2500, JSON.stringify(S1.shares));
    ok('per-person rounded totals are [20,20,25]', JSON.stringify(S1.rounded) === '[20,20,25]', JSON.stringify(S1.rounded));
    ok('exact bill is 63', S1.bill === 63, String(S1.bill));
    ok('collected is 65', S1.collected === 65, String(S1.collected));
    ok('surplus is +2', S1.surplus === 2, String(S1.surplus));

    // ── INVARIANT: no rounded/collected figure may enter the restaurant text ──
    const rtext = w.eval(`(function(){
      S.orders=[
        {name:'أحمد',items:[{name:'شاي',qty:1,price:10}],orderedBy:'أحمد'},
        {name:'سارة',items:[{name:'قهوة',qty:1,price:12}],orderedBy:'سارة'},
        {name:'محمد',items:[{name:'فول',qty:2,price:8}],orderedBy:'محمد'}
      ];
      S.deliveryFee=25;
      return buildRestaurantText();
    })()`);
    ok('restaurant text lists the items', /شاي × 1/.test(rtext) && /قهوة × 1/.test(rtext) && /فول × 2/.test(rtext));
    ok('restaurant text carries the EXACT delivery fee', /توصيل 25/.test(rtext), rtext.split('\n').pop());
    ok('restaurant text counts items exactly (4 صنف)', /4 صنف/.test(rtext));
    ok('restaurant text does NOT leak the collected total (65)', !rtext.includes('65'), rtext);
    ok('restaurant text does NOT leak a rounding label', !/للتحصيل|الزيادة|ناقص التقريب/.test(rtext));

    console.log(`\n=== rounding: ${pass} passed, ${fail} failed ===`);
    process.exit(fail ? 1 : 0);
  } catch (e) { console.error('HARNESS ERROR:', e); process.exit(1); }
}, 400));
