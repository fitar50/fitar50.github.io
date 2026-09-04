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
  orderingOpen: false,       // NEW: manager controls whether ordering is open
  currentName: null,
  currentQty: {},
  currentNotes: {},          // NEW: { [itemName]: noteText }
  mgrKey: null,
  orderedBy: null,
  editName: null,
  editQty: {},
  editNotes: {},             // NEW: preserve per-item notes through manager edits
  mgrRefreshTimer: null,
  isDirty: false,
  _serverOrdersCount: null
};

// ================================================================
// USER STATUS POLL
// Polls getStatus every 10 s on user-facing screens.
// Handles: lock → show closed screen
//          orderingOpen toggle → show/hide name screen
// ================================================================
let _userPollTimer = null;

function startUserPoll() {
  if (_userPollTimer) return;
  _userPollTimer = setInterval(async () => {
    const active   = document.querySelector('.screen.active');
    const screenId = active ? active.id : null;
    const relevant = ['screen-name', 'screen-order', 'screen-submitted', 'screen-not-open'];
    if (!relevant.includes(screenId)) return;

    try {
      const r = await api('getStatus');

      // Ordering just locked
      if (r.locked && !S.isLocked) {
        S.isLocked = true;
        S.lockTime = r.lockTime;
        stopUserPoll();
        showToast('🔒 الطلبات اتقفلت!');
        // Refetch orders so the closed-screen total + delivery split are accurate
        // (S.orders may be stale if others ordered after this user loaded the page).
        api('getOrders')
          .then(fresh => { if (fresh && fresh.data) S.orders = fresh.data; })
          .catch(() => {})
          .finally(() => setTimeout(() => renderClosedScreen(S.currentName), 400));
        return;
      }

      // Ordering just opened (while user is on not-open screen)
      if (r.orderingOpen === true && !S.orderingOpen && screenId === 'screen-not-open') {
        S.orderingOpen = true;
        renderNameScreen();
        return;
      }

      // Ordering just closed (while user is on name/order/submitted screen)
      if (r.orderingOpen === false && S.orderingOpen && ['screen-name'].includes(screenId)) {
        S.orderingOpen = false;
        showToast('الطلبات اتقفلت مؤقتاً');
        renderNotOpenScreen();
        return;
      }

      S.orderingOpen = r.orderingOpen === true;

      // Keep order count fresh for delivery split
      if (typeof r.ordersCount === 'number') {
        S._serverOrdersCount = r.ordersCount;
      }
    } catch (e) {
      // Silently swallow poll errors
    }
  }, 10000);
}

function stopUserPoll() {
  if (_userPollTimer) {
    clearInterval(_userPollTimer);
    _userPollTimer = null;
  }
}

/* ---------- INIT ---------- */
async function init() {
  showScreen('screen-loading');

  const failsafe = setTimeout(() => renderErrorScreen(), 20000);

  try {
    const params    = new URLSearchParams(window.location.search);
    const isMgrMode = params.has(MGR_PARAM);

    const ok = await initLoad();
    clearTimeout(failsafe);

    if (!ok) { renderErrorScreen(); return; }

    if (isMgrMode) { renderManagerLogin(); return; }

    if (S.isLocked) {
      renderClosedScreen(null);
    } else if (!S.orderingOpen) {
      startUserPoll();          // poll so we notice when manager opens ordering
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
// Prevents accidental double-taps on network / destructive actions.
// Rapid UI actions (qty steppers, expand/collapse, note toggle) are EXEMPT so
// users can tap +/- quickly — the old global 200 ms guard swallowed those taps.
let _lastClickTime = 0;
const NO_DEBOUNCE = new Set(['qty', 'editQty', 'toggleNote', 'toggleCat', 'toggleOC']);

/* ---------- EVENT DELEGATION ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;

  // 150 ms debounce for everything except the rapid-tap UI actions
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
    case 'promptEditName':  promptEditName();  break;
    case 'saveEditName':    saveEditName();    break;
    case 'cancelEditName':  cancelEditName();  break;

    case 'clearOrder':    clearAllItems(); break;
    case 'cancelMyOrder': handleCancelOrder(el); break;

    case 'goBackToName':
      S.currentQty   = {};
      S.currentNotes = {};
      S.isDirty      = false;
      S.orderedBy    = null;
      renderNameScreen();
      break;

    // Order screen
    case 'qty': {
      const id    = parseInt(el.dataset.id,    10);
      const delta = parseInt(el.dataset.delta, 10);
      chgQty(id, delta);
      S.isDirty = true;
      break;
    }
    case 'toggleNote': {
      const id = parseInt(el.dataset.id, 10);
      toggleNoteInput(id);
      break;
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
    case 'refreshManager':    refreshManagerDashboard(); break;
    case 'doLock':            doLock();            break;
    case 'doReset':           doReset();           break;
    case 'doToggleOrdering':  doToggleOrdering();  break;
    case 'mgrAddName':        mgrAddNewName();     break;
    case 'deleteOrder': {
      const name = el.dataset.name;
      if (name) doDeleteOrder(name, el);
      break;
    }
    case 'deleteName': {
      const name = el.dataset.name;
      if (name) doDeleteName(name, el);
      break;
    }
    case 'openModal': {
      const name = el.dataset.name;
      if (name) openModal(name);
      break;
    }
    case 'toggleOC': {
      const body = el.nextElementSibling;
      if (body) {
        body.classList.toggle('open');
        const card = el.closest('.order-card');
        if (card) card.classList.toggle('open');
      }
      break;
    }
    case 'mgrAddPerson': mgrAddPerson(); break;
    case 'copyOrder': {
      const text = buildRestaurantText();
      navigator.clipboard.writeText(text)
        .then(() => showToast('تم النسخ ✓'))
        .catch(() => showToast('فشل النسخ'));
      break;
    }

    // Edit modal
    case 'editQty': {
      const id    = parseInt(el.dataset.id,    10);
      const delta = parseInt(el.dataset.delta, 10);
      chgEditQty(id, delta);
      break;
    }
    case 'closeModal': closeModal(); break;
    case 'saveModal':  saveModal();  break;

    // Error screen
    case 'retryInit': init().catch(() => renderErrorScreen()); break;
  }
});

// Native-event listeners
document.getElementById('nameSelect').addEventListener('change', onNameSelectChange);
document.getElementById('closedNameSelect').addEventListener('change', lookupClosedOrder);
document.getElementById('mgrCodeInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doManagerLogin();
});

// Note input listener — delegated on the menu container
document.addEventListener('input', e => {
  if (!e.target.matches('.note-input')) return;
  const id   = parseInt(e.target.dataset.itemId, 10);
  const item = S.menuFlat[id];
  if (!item) return;
  const val = e.target.value;  // keep spaces while typing; trim on submit
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

// mgrNewNameInput: Enter key shortcut
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'mgrNewNameInput') mgrAddNewName();
});

/* ---------- NAME SCREEN LOGIC ---------- */
function onNameSelectChange() {
  const val = document.getElementById('nameSelect').value;
  // Edit button: show only when an existing name is selected
  document.getElementById('editNameBtn').style.display  = val ? 'flex' : 'none';
  document.getElementById('editNameWrap').style.display = 'none';
}

async function proceedWithName() {
  const val = document.getElementById('nameSelect').value;
  if (!val) { showToast('اختار اسمك الأول'); return; }

  const btn = document.querySelector('[data-action="proceedWithName"]');
  setBtnLoading(btn, 'جاري التحقق');

  const name = val;

  // When ordering as proxy, refresh orders to get latest state
  if (S.orderedBy) {
    try {
      const fresh = await api('getOrders');
      S.orders = fresh.data || [];
    } catch (e) {}
  }

  resetBtn(btn);

  S.currentQty   = {};
  S.currentNotes = {};
  S.isDirty      = false;

  const existing = S.orders.find(o => normAr(o.name) === normAr(name));
  if (existing) {
    if (S.orderedBy) {
      showConfirm(`عند ${h(name)} طلب موجود — هتعدل عليه؟`, () => {
        S.currentName = name;
        existing.items.forEach(i => {
          S.currentQty[i.name] = i.qty;
          if (i.note) S.currentNotes[i.name] = i.note;
        });
        renderOrderScreen(name);
      });
      return;
    } else {
      S.currentName = name;
      existing.items.forEach(i => {
        S.currentQty[i.name] = i.qty;
        if (i.note) S.currentNotes[i.name] = i.note;
      });
      renderSubmittedScreen();
      return;
    }
  }

  S.currentName = name;
  renderOrderScreen(name);
}

function promptEditName() {
  const val = document.getElementById('nameSelect').value;
  if (!val) return;
  const inp  = document.getElementById('editNameInput');
  const wrap = document.getElementById('editNameWrap');
  inp.value  = val;
  wrap.style.display = 'block';
  setTimeout(() => inp.focus(), 50);
}

function saveEditName() {
  const oldName = document.getElementById('nameSelect').value;
  const newName = document.getElementById('editNameInput').value.trim();
  document.getElementById('editNameWrap').style.display = 'none';
  if (!newName || newName === oldName) return;
  doUpdateName(oldName, newName);
}

function cancelEditName() {
  document.getElementById('editNameWrap').style.display = 'none';
  document.getElementById('editNameInput').value = '';
}

async function doUpdateName(oldName, newName) {
  try {
    await api('updateName', { oldName, newName });
    const idx = S.names.indexOf(oldName);
    if (idx !== -1) S.names[idx] = newName;
    S.orders.forEach(o => {
      if (o.name === oldName)      o.name      = newName;
      if (o.orderedBy === oldName) o.orderedBy = newName;
    });
    fillNameDropdown('nameSelect');
    document.getElementById('nameSelect').value = newName;
    onNameSelectChange();
    showToast('تم تعديل الاسم ✓');
  } catch (e) {
    showToast('فشل تعديل الاسم ❌');
  }
}

/* ---------- NOTE TOGGLE ---------- */
function toggleNoteInput(id) {
  const wrap  = document.getElementById(`nwrap-${id}`);
  const input = document.getElementById(`ninput-${id}`);
  if (!wrap) return;
  const isOpen = wrap.style.display === 'block';
  wrap.style.display = isOpen ? 'none' : 'block';
  if (!isOpen && input) setTimeout(() => input.focus(), 60);
}

/* ---------- ORDER SCREEN LOGIC ---------- */
function handleCancelOrder(btn) {
  if (!S.currentName) return;
  showConfirm('متأكد مش هتطلب النهارده؟ الطلب هيتمسح نهائياً', async () => {
    setBtnLoading(btn, 'جاري الإلغاء');
    try {
      await cancelOrder(S.currentName);
      S.orders       = S.orders.filter(o => normAr(o.name) !== normAr(S.currentName));
      S.currentQty   = {};
      S.currentNotes = {};
      S.isDirty      = false;
      resetBtn(btn);
      S.currentName  = null;
      showToast('تم إلغاء طلبك ✓');
      setTimeout(renderNameScreen, 800);
    } catch (err) {
      resetBtn(btn);
      showToast(err.message || 'مشكلة في الإلغاء');
    }
  });
}

function clearAllItems() {
  if (!Object.keys(S.currentQty).length) return;
  S.currentQty   = {};
  S.currentNotes = {};
  S.isDirty      = false;
  document.querySelectorAll('.qty-num').forEach(el => {
    el.textContent = '0';
    el.classList.remove('nonzero');
  });
  document.querySelectorAll('.note-btn').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('has-note');
  });
  document.querySelectorAll('.note-input-wrap').forEach(el => { el.style.display = ''; });
  document.querySelectorAll('.note-input').forEach(el => { el.value = ''; });
  Object.keys(S.menu).forEach(cat => updateCatBadge(cat));
  updateTotal();
}

function chgQty(id, delta) {
  const item = S.menuFlat[id];
  const cur  = S.currentQty[item.name] || 0;
  const next = Math.max(0, cur + delta);

  if (next === 0) {
    delete S.currentQty[item.name];
    // Clear note and hide note UI when item is deselected
    delete S.currentNotes[item.name];
    const noteBtn  = document.getElementById(`nbtn-${id}`);
    const noteWrap = document.getElementById(`nwrap-${id}`);
    const noteInp  = document.getElementById(`ninput-${id}`);
    if (noteBtn)  { noteBtn.style.display = 'none'; noteBtn.classList.remove('has-note'); }
    if (noteWrap) { noteWrap.style.display = ''; }
    if (noteInp)  { noteInp.value = ''; }
  } else {
    S.currentQty[item.name] = next;
    // Show note button when item is selected
    const noteBtn = document.getElementById(`nbtn-${id}`);
    if (noteBtn) noteBtn.style.display = '';
  }

  const numEl = document.getElementById(`qn-${id}`);
  numEl.textContent = next;
  numEl.classList.toggle('nonzero', next > 0);

  updateCatBadge(item.category);
  updateTotal();
}

async function submitOrder() {
  const items = Object.entries(S.currentQty)
    .filter(([, q]) => q > 0)
    .map(([name, qty]) => {
      const obj = { name, qty, price: findPrice(name) };
      const note = (S.currentNotes[name] || '').trim();
      if (note) obj.note = note;
      return obj;
    });

  if (!items.length) { showToast('ما اخترتش حاجة'); return; }

  const btn = document.getElementById('submitBtn');
  setBtnLoading(btn, 'جاري الإرسال');

  try {
    await api('submitOrder', {
      data: { name: S.currentName, items, orderedBy: S.orderedBy || S.currentName }
    });

    const idx = S.orders.findIndex(o => o.name === S.currentName);
    if (idx !== -1) S.orders[idx].items = items;
    else S.orders.push({ name: S.currentName, items, orderedBy: S.orderedBy || S.currentName });

    S.orderedBy = null;
    S.isDirty   = false;
    resetBtn(btn);
    saveSubmitTime(S.currentName);
    renderSubmittedScreen();
    showToast('تم حفظ الطلب ✓');
  } catch (e) {
    if (e.message === 'الطلبات مقفولة') {
      S.isLocked = true;
      stopUserPoll();
      showToast('🔒 الطلبات اتقفلت!');
      renderClosedScreen(S.currentName);
    } else if (e.message === 'الطلبات مش مفتوحة') {
      // Manager paused ordering while this order was still in progress
      S.orderingOpen = false;
      resetBtn(btn);
      showToast('الطلبات اتقفلت مؤقتاً');
      renderNotOpenScreen();
    } else {
      showToast('خطأ في الإرسال — حاول تاني ❌');
      resetBtn(btn);
    }
  }
}

/* ---------- SUBMITTED SCREEN LOGIC ---------- */
function editMyOrder() {
  if (S.isLocked) {
    showToast('🔒 الطلبات اتقفلت، مش ممكن تعدل');
    renderClosedScreen(S.currentName);
    return;
  }
  // Restore notes from current order record
  const order = S.orders.find(o => o.name === S.currentName);
  S.currentNotes = {};
  if (order) order.items.forEach(i => { if (i.note) S.currentNotes[i.name] = i.note; });
  renderOrderScreen(S.currentName);
}

function orderForAnother() {
  S.orderedBy    = S.currentName;
  S.currentName  = null;
  S.currentQty   = {};
  S.currentNotes = {};
  S.isDirty      = false;
  renderNameScreen();
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
window.addEventListener('beforeunload', e => {
  if (S.isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('load', () => {
  // Modal backdrop dismissals
  document.getElementById('editModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  document.getElementById('confirmModal').addEventListener('click', function(e) {
    if (e.target === this) cancelConfirm();
  });

  init().catch(() => renderErrorScreen());
});
