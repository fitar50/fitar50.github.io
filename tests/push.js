const { JSDOM } = require('jsdom');
const path = require('path').resolve(__dirname, '..');
const VAPID = 'BK9f9z5u3alduDTMPegLeGIgUGvIPPF6Hn6h_Q3MBDRRsnGZpcH7_qwt2Ofg0Rsq2Z8_OWIpwaQmbuvEmKNeU6o';
const saved = [];
const API = {
  getAll: { success: true,
    menu: { 'sakhna': [{ name: 'shai', price: 10 }] }, names: ['a', 'b'],
    orders: [{ name: 'b', items: [{ name: 'shai', qty: 2, price: 10 }], orderedBy: 'b' }],
    locked: false, lockTime: '', orderingOpen: true, ordersCount: 1,
    restaurants: [{ id: 1, name: 'k', delivery_fee: 25 }], activeRestaurantId: 1, deliveryFee: 25,
    noteSuggestions: {}, lastOrders: {},
    paymentInfo: { collectorName: 'a', paymentCash: true, paymentInstapay: false, instapayNumber: '' },
    vapidPublicKey: VAPID },
  getStatus: { success: true, locked: false, lockTime: '', orderingOpen: true, ordersCount: 1, activeRestaurantId: 1, deliveryFee: 25, paymentInfo: { collectorName: 'a', paymentCash: true, paymentInstapay: false, instapayNumber: '' } },
  getOrders: { success: true, data: [{ name: 'b', items: [{ name: 'shai', qty: 2, price: 10 }], orderedBy: 'b' }] },
  submitOrder: { success: true },
  savePushSubscription: { success: true }
};
const errors = [];
const dom = new JSDOM(require('fs').readFileSync(path + '/index.html', 'utf8'), {
  runScripts: 'dangerously', resources: 'usable', url: 'file://' + path + '/index.html', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = async (url, opts) => { const b = JSON.parse(opts.body); if (b.action === 'savePushSubscription') saved.push(b); return { json: async () => (API[b.action] || { success: true }) }; };
    w.scrollTo = () => {};
    w.addEventListener('error', e => errors.push(e.message));
    w.Notification = { permission: 'default', requestPermission: async () => { w.Notification.permission = 'granted'; return 'granted'; } };
    w.PushManager = function () {};
    const fakeSub = { endpoint: 'https://push.example/xyz', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
    let current = null;
    const reg = { pushManager: { getSubscription: async () => current, subscribe: async (opts) => { if (!(opts.applicationServerKey instanceof w.Uint8Array)) throw new Error('bad key'); current = fakeSub; return fakeSub; } } };
    Object.defineProperty(w.navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg), controller: null, register: async () => reg, addEventListener() {} } });
  }
});
const w = dom.window;
w.addEventListener('load', () => setTimeout(async () => {
  const $ = s => w.document.querySelector(s);
  let pass = 0, fail = 0;
  const OK = (l, c, x) => { if (c) pass++; else fail++; console.log((c ? 'PASS' : '*** FAIL ***') + '  ' + l + (x ? '  ' + x : '')); };
  try {
    OK('vapid key loaded into S', w.eval('S').vapidPublicKey === VAPID);
    w.eval("S.currentName='b'; S.currentQty={'shai':1}; S.currentNotes={};");
    w.eval('renderSubmittedScreen()');
    await new Promise(r => setTimeout(r, 60));
    const act = $('.screen.active');
    OK('submitted screen active', act && act.id === 'screen-submitted', act && act.id);
    OK('push prompt visible', $('#pushPrompt').style.display !== 'none');
    OK('enable button shown when permission default', !!$('#pushPrompt [data-action=enablePush]'));
    const btn = $('#pushPrompt [data-action=enablePush]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 120));
    OK('savePushSubscription called once', saved.length === 1, 'count=' + saved.length);
    OK('sent with endpoint + name', !!saved[0] && saved[0].subscription.endpoint === 'https://push.example/xyz' && saved[0].name === 'b');
    await w.eval('renderPushPrompt()');
    await new Promise(r => setTimeout(r, 40));
    OK('shows enabled state after grant', $('#pushPrompt').innerHTML.indexOf('push-on') !== -1);
    OK('no window errors', errors.length === 0, errors.join('|'));
    console.log('\nPASS ' + pass + '  FAIL ' + fail);
    process.exit(fail ? 1 : 0);
  } catch (e) { console.log('HARNESS ERROR', (e && e.stack) || e); process.exit(1); }
}, 300));
