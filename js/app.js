// ================================================================
// MAIN APP LOGIC
// ================================================================

const S = {
  menu: {},
  menuFlat: [],
  names: [],
  orders: [],
  isLocked: false,
  lockTime: '',
  orderingOpen: false,
  currentName: null,
  currentQty: {},
  currentNotes: {},
  currentNoteQty: {},
  mgrKey: null,
  orderedBy: null,
  editName: null,
  editQty: {},
  editNotes: {},
  editNoteQty: {},
  mgrRefreshTimer: null,
  isDirty: false,
  _serverOrdersCount: null,

  // Effective delivery fee for today, from the server. Never hardcode a
  // fallback: if the server says 0, the split is 0.
  deliveryFee: 0,
  // { "<item name>": ["note", ...] } for the active restaurant only.
  noteSuggestions: {},

  // New: multi-restaurant + payment
  restaurants: [],
  activeRestaurantId: null,
  paymentInfo: { collectorName: '', paymentCash: false, paymentInstapay: false, instapayNumber: '' },

  // Manager-only. Carries instapay_number per person; never used by user screens.
  namesAdmin: [],
  deliveryOverride: '',

  // Super manager
  superKey: null,
  superData: []   // [{id, name, items: [{id, restaurant_id, category, name, price, sort_order}]}]
};

// ================================================================
// USER STATUS POLL
// ================================================================
let _userPollTimer = null;

function startUserPoll() {
  if (_userPollTimer) return;
  _userPollTimer = setInterval(async () => {
    const active   = document.querySelector('.screen.active');
    const screenId = active ? active.id : null;
    // screen-closed is included on purpose: money changes hands AFTER locking,
    // so that is exactly when a collector change has to reach people.
    const relevant = ['screen-name', 'screen-order', 'screen-submitted', 'screen-not-open', 'screen-closed'];
    if (!relevant.includes(screenId)) return;

    try {
      const r = await api('getStatus');

      if (r.locked && !S.isLocked) {
        S.isLocked = true;
        S.lockTime = r.lockTime;
        // Poll deliberately keeps running: see the screen-closed cases below.
        showToast('🔒 الطلبات اتقفلت!');
        api('getOrders')
          .then(fresh => { if (fresh && fresh.data) S.orders = fresh.data; })
          .catch(() => {})
          .finally(() => setTimeout(() => renderClosedScreen(S.currentName), 400));
        return;
      }

      // The day was reset (or unlocked) while the user was on the closed screen.
      // Without this they keep staring at yesterday's order and its totals.
      if (!r.locked && S.isLocked) {
        S.isLocked = false;
        S.lockTime = '';
        S.orderingOpen = r.orderingOpen === true;
        S.currentName = null;
        S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
        S.isDirty = false;
        try {
          const fresh = await api('getOrders');
          if (fresh && fresh.data) S.orders = fresh.data;
        } catch (e) { /* ignore */ }
        showToast('اتعمل تصفير — يوم جديد');
        if (S.orderingOpen) renderNameScreen(); else renderNotOpenScreen();
        return;
      }

      if (r.orderingOpen === true && !S.orderingOpen && screenId === 'screen-not-open') {
        S.orderingOpen = true;
        renderNameScreen();
        return;
      }

      // Ordering closed while the user is still here. This also covers a
      // manager reset, which deletes every order: without the screen-submitted
      // case the user keeps staring at an order that no longer exists and
      // believes their breakfast is on the way.
      // screen-order is deliberately excluded: kicking them out would destroy
      // in-progress selections, and submitOrder already redirects on failure.
      if (r.orderingOpen === false && S.orderingOpen &&
          ['screen-name', 'screen-submitted'].includes(screenId)) {
        S.orderingOpen = false;
        const orderGone = screenId === 'screen-submitted' &&
          !(r.ordersCount > 0 && S.orders.some(o => normAr(o.name) === normAr(S.currentName)));
        S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
        S.isDirty = false;
        showToast(orderGone ? 'اتعمل تصفير للطلبات — طلبك اتمسح' : 'الطلبات اتقفلت مؤقتاً');
        renderNotOpenScreen();
        return;
      }

      S.orderingOpen = r.orderingOpen === true;

      // Delivery fee is server-driven (restaurant fee, or the manager's daily
      // override). Apply before any re-render that shows the split.
      if (typeof r.deliveryFee === 'number') S.deliveryFee = r.deliveryFee;

      // Refresh the orders list when the server count moved, so the name
      // dropdown ticks and the "طلب X من Y" counter stop going stale.
      // Compare against _serverOrdersCount, NOT S.orders.length: the latter
      // refetches forever when a name is deleted but its order remains.
      if (typeof r.ordersCount === 'number') {
        const countChanged = r.ordersCount !== S._serverOrdersCount;
        S._serverOrdersCount = r.ordersCount;

        if (countChanged) {
          try {
            const fresh = await api('getOrders');
            if (fresh && fresh.data) {
              S.orders = fresh.data;
              // Only on the name screen. Re-rendering screen-order would wipe
              // the user's in-progress quantities and notes.
              if (screenId === 'screen-name') renderNameScreen();
              // On the closed screen the delivery split changes if the manager
              // removes an order, so the amount owed must be recomputed.
              if (screenId === 'screen-closed' && S.currentName) {
                const mine = S.orders.find(o => normAr(o.name) === normAr(S.currentName));
                if (mine) renderClosedOrder(S.currentName, mine.items);
                else      renderClosedScreen(null);
              }
            }
          } catch (e) { /* ignore */ }
        }
      }

      // Payment info can change mid-day (the collector might change). Re-render
      // only the payment box, and only when it actually differs: calling
      // renderSubmittedScreen() would scroll the user to the top, and rewriting
      // identical HTML every 10s flickers on some Android browsers.
      if (r.paymentInfo) {
        const before  = JSON.stringify(S.paymentInfo);
        S.paymentInfo = r.paymentInfo;
        if (JSON.stringify(S.paymentInfo) !== before) {
          if (screenId === 'screen-submitted') {
            const box = document.getElementById('subPaymentBox');
            if (box) box.innerHTML = _buildPaymentBox();
          } else if (screenId === 'screen-closed') {
            const box = document.getElementById('closedPaymentBox');
            if (box) box.innerHTML = _buildPaymentBox();
          }
        }
      }
    } catch (e) { /* swallow */ }
  }, 10000);
}

function stopUserPoll() {
  if (_userPollTimer) { clearInterval(_userPollTimer); _userPollTimer = null; }
}

/* ---------- INIT ---------- */
async function init() {
  showScreen('screen-loading');
  const failsafe = setTimeout(() => renderErrorScreen(), 20000);

  try {
    const params         = new URLSearchParams(window.location.search);
    const isMgrMode      = params.has(MGR_PARAM);
    const isSuperMgrMode = params.has(SUPER_MGR_PARAM);

    const ok = await initLoad();
    clearTimeout(failsafe);

    if (!ok) { renderErrorScreen(); return; }

    if (isSuperMgrMode) { renderSuperMgrLogin(); return; }
    if (isMgrMode)      { renderManagerLogin();  return; }

    if (S.isLocked) {
      renderClosedScreen(null);
    } else if (!S.orderingOpen) {
      startUserPoll();
      renderNotOpenScreen();
    } else {
      startUserPoll();
      renderNameScreen();
    }
  } catch (err) {
    clearTimeout(failsafe);
    renderErrorScreen();
  }
}

/* ---------- CLICK DEBOUNCE ---------- */
let _lastClickTime = 0;
const NO_DEBOUNCE = new Set(['qty', 'editQty', 'toggleNote', 'toggleCat', 'toggleOC', 'noteQtyAdj', 'smToggleCat', 'smToggleItem', 'pickNote']);

/* ---------- EVENT DELEGATION ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;

  if (!NO_DEBOUNCE.has(action)) {
    const now = Date.now();
    if (now - _lastClickTime < 150) { e.stopPropagation(); return; }
    _lastClickTime = now;
  }

  switch (action) {
    // Confirm sheet
    case 'doConfirm':     doConfirm();     break;
    case 'cancelConfirm': cancelConfirm(); break;

    // Name screen
    case 'proceedWithName': proceedWithName(); break;

    case 'clearOrder':    clearAllItems(); break;
    case 'cancelMyOrder': handleCancelOrder(el); break;

    case 'goBackToName':
      S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
      S.isDirty = false; S.orderedBy = null;
      renderNameScreen();
      break;

    // Order screen
    case 'qty': {
      const id = parseInt(el.dataset.id, 10); const delta = parseInt(el.dataset.delta, 10);
      chgQty(id, delta); S.isDirty = true;
      break;
    }
    case 'toggleNote':  { const id = parseInt(el.dataset.id, 10); toggleNoteInput(id); break; }
    case 'pickNote': {
      const id = parseInt(el.dataset.id, 10);
      pickNoteSuggestion(id, el.dataset.note || '');
      break;
    }
    case 'noteQtyAdj': {
      const id = parseInt(el.dataset.id, 10); const delta = parseInt(el.dataset.delta, 10);
      adjNoteQty(id, delta); break;
    }
    case 'toggleCat': {
      const block = el.closest('.category-block');
      if (block) block.classList.toggle('open');
      break;
    }
    case 'submitOrder':    submitOrder();    break;
    case 'editMyOrder':    editMyOrder();    break;
    case 'orderForAnother': orderForAnother(); break;

    // Closed screen
    case 'lookupClosedOrder': lookupClosedOrder(); break;

    // Manager login
    case 'doManagerLogin': doManagerLogin(); break;
    case 'showMgrLogin':   renderManagerLogin(); break;
    case 'exitManager':    exitManager();    break;

    // Manager dashboard
    case 'refreshManager':   refreshManagerDashboard(); break;
    case 'doLock':           doLock();           break;
    case 'doReset':          doReset();          break;
    case 'doToggleOrdering': doToggleOrdering(); break;
    case 'mgrAddName':       mgrAddNewName();    break;
    case 'doSetRestaurant':    doSetRestaurant();    break;
    case 'doSavePayment':      doSavePayment();      break;
    case 'doSaveFeeOverride':  doSaveFeeOverride();  break;
    case 'doClearFeeOverride': doClearFeeOverride(); break;
    case 'togglePaid': {
      const name = el.dataset.name;
      if (name) doTogglePaid(name, el.dataset.paid === '1', el);
      break;
    }

    case 'deleteOrder': {
      const name = el.dataset.name; if (name) doDeleteOrder(name, el); break;
    }
    case 'deleteName': {
      const name = el.dataset.name; if (name) doDeleteName(name, el); break;
    }
    case 'openModal': {
      const name = el.dataset.name; if (name) openModal(name); break;
    }
    case 'toggleOC': {
      const body = el.nextElementSibling;
      if (body) {
        body.classList.toggle('open');
        const card = el.closest('.order-card');
        if (card) card.classList.toggle('open');
        try {
          const openNames = [];
          document.querySelectorAll('.order-card.open .oc-name').forEach(n => openNames.push(n.textContent.trim()));
          localStorage.setItem('mgrOpenCards', JSON.stringify(openNames));
        } catch (_e) {}
      }
      break;
    }
    case 'mgrAddPerson': mgrAddPerson(); break;
    case 'copyOrder': {
      // Re-read from the server first: this text is what the restaurant cooks.
      copyRestaurantText();
      break;
    }

    // Edit modal
    case 'editQty': {
      const id = parseInt(el.dataset.id, 10); const delta = parseInt(el.dataset.delta, 10);
      chgEditQty(id, delta); break;
    }
    case 'closeModal': closeModal(); break;
    case 'saveModal':  saveModal();  break;

    // Super manager
    case 'doSuperMgrLogin':    doSuperMgrLogin();    break;
    case 'exitSuperMgr':       exitSuperMgr();       break;
    case 'smAddRestaurant':    smAddRestaurant();     break;
    case 'smDeleteRestaurant': {
      const id = parseInt(el.dataset.id); if (id) smDeleteRestaurant(id, el); break;
    }
    case 'smRenameRestaurant': {
      const id = parseInt(el.dataset.id); if (id) smStartRenameRestaurant(id, el); break;
    }
    case 'smSaveRenameRestaurant': {
      const id = parseInt(el.dataset.id); if (id) smSaveRenameRestaurant(id, el); break;
    }
    case 'smCancelRename': { smCancelRename(el); break; }
    case 'smToggleCat': {
      const block = el.closest('.sm-cat-block');
      if (block) {
        block.classList.toggle('open');
        if (typeof smTrackCatToggle === 'function') smTrackCatToggle(block);
      }
      break;
    }
    case 'smAddItem': {
      const restId = parseInt(el.dataset.restId);
      const cat    = el.dataset.cat;
      if (el.dataset.uid && restId && cat) smAddItem(el.dataset.uid, restId, cat);
      break;
    }
    case 'smSaveFee': {
      const id = parseInt(el.dataset.id); if (id) smSaveFee(id); break;
    }
    case 'smDeleteNote': {
      const id = parseInt(el.dataset.id); if (id) smDeleteNote(id); break;
    }
    case 'smDeleteItem': {
      const id = parseInt(el.dataset.id); if (id) smDeleteItem(id, el); break;
    }
    case 'smToggleItem': {
      const id = parseInt(el.dataset.id); if (id) smToggleEditItem(id, el); break;
    }
    case 'smSaveItem': {
      const id = parseInt(el.dataset.id); if (id) smSaveItem(id, el); break;
    }
    case 'smAddCategory': {
      const restId = parseInt(el.dataset.restId); if (restId) smAddCategory(restId); break;
    }
    case 'smRenameCategory': {
      if (el.dataset.uid) smStartRenameCategory(el.dataset.uid);
      break;
    }
    case 'smSaveRenameCategory': {
      const restId = parseInt(el.dataset.restId);
      const cat    = el.dataset.cat;
      if (el.dataset.uid && restId && cat) smSaveRenameCategory(el.dataset.uid, restId, cat);
      break;
    }
    case 'smDeleteCategory': {
      const restId = parseInt(el.dataset.restId);
      const cat    = el.dataset.cat;
      if (restId && cat) smDeleteCategory(restId, cat, el);
      break;
    }
    case 'showSuperMgrFromMgr': renderSuperMgrLogin(); break;

    // Error screen
    case 'retryInit': init().catch(() => renderErrorScreen()); break;
  }
});

// Native-event listeners
document.getElementById('closedNameSelect').addEventListener('change', lookupClosedOrder);
document.getElementById('mgrCodeInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doManagerLogin();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'mgrNewNameInput') mgrAddNewName();
  if (e.key === 'Enter' && e.target.id === 'superMgrCodeInput') doSuperMgrLogin();
});

// Show/hide instapay number field when checkbox changes
document.addEventListener('change', e => {
  if (e.target.id === 'collectorSel') { onCollectorChange(); return; }
  if (e.target.id === 'payInstapay') {
    const row = document.getElementById('instapayRow');
    if (row) row.style.display = e.target.checked ? 'block' : 'none';
  }
});

document.addEventListener('input', e => {
  if (!e.target.matches('.note-input')) return;
  const id   = parseInt(e.target.dataset.id, 10);
  const item = S.menuFlat[id];
  if (!item) return;
  const val = e.target.value;
  if (val) {
    S.currentNotes[item.name] = val;
    const btn = document.getElementById(`nbtn-${id}`);
    if (btn) btn.classList.add('has-note');
  } else {
    delete S.currentNotes[item.name];
    const btn = document.getElementById(`nbtn-${id}`);
    if (btn) btn.classList.remove('has-note');
  }
});

/* ---------- NAME SCREEN LOGIC ---------- */
async function proceedWithName() {
  const val = document.getElementById('nameSelect').value;
  if (!val) { showToast('اختار اسمك الأول'); return; }

  const btn = document.querySelector('[data-action="proceedWithName"]');
  setBtnLoading(btn, 'جاري التحقق');
  const name = val;

  if (S.orderedBy) {
    try { const fresh = await api('getOrders'); S.orders = fresh.data || []; } catch (e) {}
  }

  resetBtn(btn);
  S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {}; S.isDirty = false;

  const existing = S.orders.find(o => normAr(o.name) === normAr(name));
  if (existing) {
    const restore = items => items.forEach(i => {
      S.currentQty[i.name] = (S.currentQty[i.name] || 0) + i.qty;
      if (i.note) {
        S.currentNotes[i.name]   = i.note;
        S.currentNoteQty[i.name] = (S.currentNoteQty[i.name] || 0) + i.qty;
      }
    });
    if (S.orderedBy) {
      showConfirm(`عند ${h(name)} طلب موجود — هتعدل عليه؟`, () => {
        S.currentName = name; restore(existing.items); renderOrderScreen(name);
      });
      return;
    } else {
      S.currentName = name; restore(existing.items); renderSubmittedScreen(); return;
    }
  }
  S.currentName = name;
  renderOrderScreen(name);
}

/* ---------- NOTE TOGGLE ---------- */
function toggleNoteInput(id) {
  const wrap  = document.getElementById(`nwrap-${id}`);
  const input = document.getElementById(`ninput-${id}`);
  if (!wrap) return;
  const isOpen = wrap.style.display === 'block';
  wrap.style.display = isOpen ? 'none' : 'block';
  const item = S.menuFlat[id];
  if (!isOpen) {
    if (input) setTimeout(() => input.focus(), 60);
    if (item) {
      const qty = S.currentQty[item.name] || 1;
      if (S.currentNoteQty[item.name] === undefined) S.currentNoteQty[item.name] = qty;
      _refreshNoteQtyDisplay(id, qty);
    }
  } else {
    if (item && !S.currentNotes[item.name]) delete S.currentNoteQty[item.name];
    _refreshNoteQtyDisplay(id, 0);
  }
}
// Tapping a suggestion REPLACES the field contents (never appends). The user
// can still edit the text afterwards; the existing `input` listener keeps
// S.currentNotes in sync, so do not add a second listener here.
function pickNoteSuggestion(id, note) {
  const item = S.menuFlat[id];
  if (!item) return;

  const inp = document.getElementById(`ninput-${id}`);
  if (inp) inp.value = note;
  S.currentNotes[item.name] = note;

  const btn = document.getElementById(`nbtn-${id}`);
  if (btn) btn.classList.add('has-note');

  // Mirror what typing does, so the "applies to N of M" counter behaves.
  const qty = S.currentQty[item.name] || 1;
  if (S.currentNoteQty[item.name] === undefined) S.currentNoteQty[item.name] = qty;
  _refreshNoteQtyDisplay(id, qty);

  const row = document.getElementById(`nchips-${id}`);
  if (row) row.querySelectorAll('.note-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.note === note);
  });

  S.isDirty = true;
}

function adjNoteQty(id, delta) {
  const item = S.menuFlat[id]; if (!item) return;
  const qty = S.currentQty[item.name] || 1;
  const cur = S.currentNoteQty[item.name] ?? qty;
  S.currentNoteQty[item.name] = Math.min(qty, Math.max(1, cur + delta));
  _refreshNoteQtyDisplay(id, qty);
}
function _refreshNoteQtyDisplay(id, totalQty) {
  const item  = S.menuFlat[id];
  const nqrow = document.getElementById(`nqrow-${id}`);
  if (!nqrow || !item) return;
  const nwrap = document.getElementById(`nwrap-${id}`);
  const noteIsOpen = nwrap && nwrap.style.display === 'block';
  if (noteIsOpen && totalQty > 1) {
    const nq = S.currentNoteQty[item.name] ?? totalQty;
    const numEl = document.getElementById(`nqnum-${id}`);
    const ofEl  = document.getElementById(`nqof-${id}`);
    if (numEl) numEl.textContent = nq;
    if (ofEl)  ofEl.textContent  = `من ${totalQty}`;
    nqrow.style.display = 'flex';
  } else {
    nqrow.style.display = 'none';
  }
}

/* ---------- ORDER SCREEN LOGIC ---------- */
function handleCancelOrder(btn) {
  if (!S.currentName) return;
  showConfirm('متأكد مش هتطلب النهارده؟ الطلب هيتمسح نهائياً', async () => {
    setBtnLoading(btn, 'جاري الإلغاء');
    try {
      await cancelOrder(S.currentName);
      S.orders = S.orders.filter(o => normAr(o.name) !== normAr(S.currentName));
      S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
      S.isDirty = false; resetBtn(btn); S.currentName = null;
      showToast('تم إلغاء طلبك ✓');
      setTimeout(renderNameScreen, 800);
    } catch (err) { resetBtn(btn); showToast(err.message || 'مشكلة في الإلغاء'); }
  });
}

function clearAllItems() {
  if (!Object.keys(S.currentQty).length) return;
  S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {}; S.isDirty = false;
  document.querySelectorAll('.qty-num').forEach(el => { el.textContent = '0'; el.classList.remove('nonzero'); });
  document.querySelectorAll('.note-btn').forEach(el => { el.style.display = 'none'; el.classList.remove('has-note'); });
  document.querySelectorAll('.note-input-wrap').forEach(el => { el.style.display = ''; });
  document.querySelectorAll('.note-input').forEach(el => { el.value = ''; });
  document.querySelectorAll('.note-chip').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.note-qty-row').forEach(el => { el.style.display = 'none'; });
  Object.keys(S.menu).forEach(cat => updateCatBadge(cat));
  updateTotal();
}

function chgQty(id, delta) {
  const item = S.menuFlat[id];
  const cur  = S.currentQty[item.name] || 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) {
    delete S.currentQty[item.name];
    delete S.currentNotes[item.name];
    delete S.currentNoteQty[item.name];
    const noteBtn  = document.getElementById(`nbtn-${id}`);
    const noteWrap = document.getElementById(`nwrap-${id}`);
    const noteInp  = document.getElementById(`ninput-${id}`);
    if (noteBtn)  { noteBtn.style.display = 'none'; noteBtn.classList.remove('has-note'); }
    if (noteWrap) { noteWrap.style.display = ''; }
    if (noteInp)  { noteInp.value = ''; }
    const chipRow = document.getElementById(`nchips-${id}`);
    if (chipRow) chipRow.querySelectorAll('.note-chip').forEach(c => c.classList.remove('selected'));
    _refreshNoteQtyDisplay(id, 0);
  } else {
    S.currentQty[item.name] = next;
    const noteBtn = document.getElementById(`nbtn-${id}`);
    if (noteBtn) noteBtn.style.display = '';
    if (S.currentNoteQty[item.name] !== undefined)
      S.currentNoteQty[item.name] = Math.min(S.currentNoteQty[item.name], next);
    _refreshNoteQtyDisplay(id, next);
  }
  const numEl = document.getElementById(`qn-${id}`);
  numEl.textContent = next;
  numEl.classList.toggle('nonzero', next > 0);
  updateCatBadge(item.category);
  updateTotal();
}

async function submitOrder() {
  const items = [];
  Object.entries(S.currentQty)
    .filter(([, q]) => q > 0)
    .forEach(([name, qty]) => {
      const note    = (S.currentNotes[name] || '').trim();
      const noteQty = S.currentNoteQty[name] ?? qty;
      if (!note || noteQty >= qty) {
        const obj = { name, qty, price: findPrice(name) };
        if (note) obj.note = note;
        items.push(obj);
      } else {
        items.push({ name, qty: noteQty,       note, price: findPrice(name) });
        items.push({ name, qty: qty - noteQty,       price: findPrice(name) });
      }
    });
  if (!items.length) { showToast('ما اخترتش حاجة'); return; }

  const btn = document.getElementById('submitBtn');
  setBtnLoading(btn, 'جاري الإرسال');
  try {
    const res = await api('submitOrder', { data: { name: S.currentName, items, orderedBy: S.orderedBy || S.currentName } });

    // Adopt what the SERVER stored, never the local array. The server re-reads
    // prices from the menu, drops off-menu items, truncates notes at 200 chars
    // and caps qty at 99 - none of which the client can predict. Falls back to
    // the local copy only if the backend predates this response field.
    const canonical = (res && res.order)
      ? res.order
      : { name: S.currentName, items, orderedBy: S.orderedBy || S.currentName };

    // Match on both names: the server trims, so the stored name can differ
    // from what was sent.
    S.orders = S.orders.filter(o => o.name !== S.currentName && o.name !== canonical.name);
    S.orders.push(canonical);
    S.currentName = canonical.name;

    // Re-sync the in-progress order so "تعديل طلبي" starts from reality.
    S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
    canonical.items.forEach(i => {
      S.currentQty[i.name] = (S.currentQty[i.name] || 0) + i.qty;
      if (i.note) {
        S.currentNotes[i.name]   = i.note;
        S.currentNoteQty[i.name] = (S.currentNoteQty[i.name] || 0) + i.qty;
      }
    });
    S.orderedBy = null; S.isDirty = false; resetBtn(btn);
    saveSubmitTime(S.currentName);
    renderSubmittedScreen();
    showToast('تم حفظ الطلب ✓');
  } catch (e) {
    if (e.message === 'الطلبات مقفولة') {
      S.isLocked = true; stopUserPoll(); showToast('🔒 الطلبات اتقفلت!');
      renderClosedScreen(S.currentName);
    } else if (e.message === 'الطلبات مش مفتوحة') {
      S.orderingOpen = false; resetBtn(btn);
      showToast('الطلبات اتقفلت مؤقتاً'); renderNotOpenScreen();
    } else {
      showToast('خطأ في الإرسال — حاول تاني ❌'); resetBtn(btn);
    }
  }
}

/* ---------- SUBMITTED SCREEN LOGIC ---------- */
function editMyOrder() {
  if (S.isLocked) { showToast('🔒 الطلبات اتقفلت، مش ممكن تعدل'); renderClosedScreen(S.currentName); return; }
  const order = S.orders.find(o => o.name === S.currentName);
  S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
  if (order) order.items.forEach(i => {
    S.currentQty[i.name] = (S.currentQty[i.name] || 0) + i.qty;
    if (i.note) { S.currentNotes[i.name] = i.note; S.currentNoteQty[i.name] = (S.currentNoteQty[i.name] || 0) + i.qty; }
  });
  renderOrderScreen(S.currentName);
}

function orderForAnother() {
  S.orderedBy = S.currentName; S.currentName = null;
  S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
  S.isDirty = false; renderNameScreen();
}

/* ---------- CLOSED SCREEN LOGIC ---------- */
function lookupClosedOrder() {
  const name = document.getElementById('closedNameSelect').value;
  if (!name) return;
  const order = S.orders.find(o => normAr(o.name) === normAr(name));
  if (!order) { showToast('مش لاقيك في الطلبات'); return; }
  renderClosedOrder(name, order.items);
}

/* ---------- DIRTY ORDER WARNING ---------- */
window.addEventListener('beforeunload', e => { if (S.isDirty) { e.preventDefault(); e.returnValue = ''; } });

window.addEventListener('load', () => {
  document.getElementById('editModal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
  document.getElementById('confirmModal').addEventListener('click', function(e) { if (e.target === this) cancelConfirm(); });
  init().catch(() => renderErrorScreen());
});
