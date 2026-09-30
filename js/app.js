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
  lastOrders: {},

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
// REAL-TIME UPDATES (SSE with polling fallback)
// ================================================================
let _eventSource   = null;
let _userPollTimer = null;
let _sseRetries    = 0;

function startLiveUpdates() {
  if (_eventSource || _userPollTimer) return;
  // Try SSE first; fall back to polling if it fails
  _trySSE();
}

function stopLiveUpdates() {
  if (_eventSource) { _eventSource.close(); _eventSource = null; }
  if (_userPollTimer) { clearInterval(_userPollTimer); _userPollTimer = null; }
}

// Legacy aliases so existing call-sites (manager.js, etc.) keep working
function startUserPoll() { startLiveUpdates(); }
function stopUserPoll()  { stopLiveUpdates(); }

function _trySSE() {
  if (_eventSource) return;
  try {
    _eventSource = new EventSource(RAILWAY_URL + '/api/events');
    _eventSource.onmessage = function (e) {
      _sseRetries = 0;
      try { _handleStatusUpdate(JSON.parse(e.data)); } catch (err) {}
    };
    _eventSource.onerror = function () {
      _eventSource.close();
      _eventSource = null;
      _sseRetries++;
      if (_sseRetries < 3) {
        // Retry SSE after a short backoff
        setTimeout(_trySSE, 3000 * _sseRetries);
      } else {
        // Give up on SSE, fall back to polling
        _startPollFallback();
      }
    };
    // SSE is open; stop any active poll
    if (_userPollTimer) { clearInterval(_userPollTimer); _userPollTimer = null; }
  } catch (e) {
    _startPollFallback();
  }
}

function _startPollFallback() {
  if (_userPollTimer) return;
  _userPollTimer = setInterval(async () => {
    try {
      const r = await api('getStatus');
      _handleStatusUpdate(r);
    } catch (e) {}
    // Periodically attempt to upgrade back to SSE (e.g. after Railway wake)
    if (!_eventSource && _sseRetries >= 3 && Math.random() < 0.15) {
      _sseRetries = 0;
      clearInterval(_userPollTimer);
      _userPollTimer = null;
      _trySSE();
    }
  }, 10000);
}

// Shared handler: processes a status payload from either SSE or poll.
// Guarded against re-entrancy: if a slow handler (e.g. initLoad on reset)
// is still running, newer events are queued and the latest one wins.
let _statusBusy = false;
let _statusQueued = null;

async function _handleStatusUpdate(r) {
  if (_statusBusy) { _statusQueued = r; return; }
  _statusBusy = true;
  try {
    await _processStatus(r);
  } finally {
    _statusBusy = false;
    if (_statusQueued) {
      var next = _statusQueued;
      _statusQueued = null;
      _handleStatusUpdate(next);
    }
  }
}

async function _processStatus(r) {
  const active   = document.querySelector('.screen.active');
  const screenId = active ? active.id : null;
  const relevant = ['screen-name', 'screen-order', 'screen-submitted', 'screen-not-open', 'screen-closed', 'screen-repeat'];
  if (!relevant.includes(screenId)) return;

  // ── Lock ──────────────────────────────────────────────────────
  if (r.locked && !S.isLocked) {
    S.isLocked = true;
    S.lockTime = r.lockTime;
    if (r.paymentInfo) S.paymentInfo = r.paymentInfo;
    showToast('\u{1F512} الطلبات اتقفلت!');
    api('getOrders')
      .then(function(fresh) { if (fresh && fresh.data) S.orders = fresh.data; })
      .catch(function(){})
      .finally(function() { setTimeout(function() { renderClosedScreen(S.currentName); }, 400); });
    return;
  }

  // ── Reset (unlock) ────────────────────────────────────────────
  if (!r.locked && S.isLocked) {
    S.currentName = null;
    S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
    S.isDirty = false;
    var ok2 = await initLoad();
    S.isLocked = false;
    S.lockTime = '';
    S.orderingOpen = r.orderingOpen === true;
    if (!ok2) {}
    showToast('اتعمل تصفير \u2014 يوم جديد');
    if (S.orderingOpen) renderNameScreen(); else renderNotOpenScreen();
    return;
  }

  // ── Ordering just opened ──────────────────────────────────────
  if (r.orderingOpen === true && !S.orderingOpen && screenId === 'screen-not-open') {
    S.orderingOpen = true;
    await initLoad();
    S.orderingOpen = true;

    var rem = _loadRememberedUser();
    if (rem && S.names.some(function(n) { return normAr(n) === normAr(rem); })) {
      S.currentName = S.names.find(function(n) { return normAr(n) === normAr(rem); }) || rem;
      var ex = S.orders.find(function(o) { return normAr(o.name) === normAr(S.currentName); });
      if (ex) {
        S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
        ex.items.forEach(function(i) {
          S.currentQty[i.name] = (S.currentQty[i.name] || 0) + i.qty;
          if (i.note) { S.currentNotes[i.name] = i.note; S.currentNoteQty[i.name] = (S.currentNoteQty[i.name] || 0) + i.qty; }
        });
        renderSubmittedScreen();
      } else {
        var last2 = _lastOrderFor(S.currentName);
        var rItems = (last2 || [])
          .filter(function(i) { return S.menuFlat.some(function(f) { return f.name === i.name; }); })
          .map(function(i) { return { name: i.name, qty: i.qty, note: i.note, price: findPrice(i.name) }; });
        if (rItems.length) renderRepeatScreen(S.currentName, rItems);
        else                renderOrderScreen(S.currentName);
      }
      return;
    }

    renderNameScreen();
    return;
  }

  // ── Ordering just closed ──────────────────────────────────────
  if (r.orderingOpen === false && S.orderingOpen &&
      ['screen-name', 'screen-submitted', 'screen-repeat'].includes(screenId)) {
    S.orderingOpen = false;
    var orderGone = screenId === 'screen-submitted' &&
      !(r.ordersCount > 0 && S.orders.some(function(o) { return normAr(o.name) === normAr(S.currentName); }));
    S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
    S.isDirty = false;
    showToast(orderGone ? 'اتعمل تصفير للطلبات \u2014 طلبك اتمسح' : 'الطلبات اتقفلت مؤقتاً');
    renderNotOpenScreen();
    return;
  }

  S.orderingOpen = r.orderingOpen === true;

  // ── Delivery fee ──────────────────────────────────────────────
  var _moneyChanged = false;
  if (typeof r.deliveryFee === 'number' && r.deliveryFee !== S.deliveryFee) {
    S.deliveryFee = r.deliveryFee;
    _moneyChanged = true;
  }

  // ── Note suggestions ──────────────────────────────────────────
  if (r.noteSuggestions) {
    var before = JSON.stringify(S.noteSuggestions || {});
    S.noteSuggestions = r.noteSuggestions;
    if (screenId === 'screen-order' && JSON.stringify(S.noteSuggestions) !== before) {
      refreshNoteChips();
    }
  }

  // ── Order count ───────────────────────────────────────────────
  if (typeof r.ordersCount === 'number') {
    if (r.ordersCount !== S._serverOrdersCount) _moneyChanged = true;
    S._serverOrdersCount = r.ordersCount;

    // A count change shifts everyone's delivery split, so pull fresh orders
    // before re-rendering any money.
    if (_moneyChanged) {
      try {
        var fresh2 = await api('getOrders');
        if (fresh2 && fresh2.data) S.orders = fresh2.data;
      } catch (e2) {}
    }
  }

  // Re-render whatever money the user is looking at, with the fresh split. The
  // submitted screen used to freeze its delivery estimate here; now it tracks
  // live like the name and closed screens.
  if (_moneyChanged) {
    if (screenId === 'screen-name') renderNameScreen();
    else if (screenId === 'screen-submitted') renderSubmittedScreen();
    else if (screenId === 'screen-closed' && S.currentName) {
      var mine = S.orders.find(function(o) { return normAr(o.name) === normAr(S.currentName); });
      if (mine) renderClosedOrder(S.currentName, mine.items);
      else      renderClosedScreen(null);
    }
  }

  // ── Payment info ──────────────────────────────────────────────
  if (r.paymentInfo) {
    var beforePi  = JSON.stringify(S.paymentInfo);
    S.paymentInfo = r.paymentInfo;
    if (JSON.stringify(S.paymentInfo) !== beforePi) {
      if (screenId === 'screen-submitted') {
        var box = document.getElementById('subPaymentBox');
        if (box) box.innerHTML = S.isLocked ? _buildPaymentBox() : '';
      } else if (screenId === 'screen-closed') {
        var box2 = document.getElementById('closedPaymentBox');
        if (box2) box2.innerHTML = _buildPaymentBox();
      }
    }
  }
}

/* ---------- INIT ---------- */
async function init() {
  showScreen('screen-loading');
  // Failsafe must outlast the getAll timeout (30s) so a real load error shows
  // its own path, not this backstop, mid-flight.
  const failsafe = setTimeout(() => renderErrorScreen(), 35000);
  // Reassure the user during a Railway cold start instead of a silent spinner.
  const wakeMsg = setTimeout(() => {
    const p = document.querySelector('#screen-loading p');
    if (p) p.textContent = 'السيرفر بيصحّى... ثانية واحدة';
  }, 6000);
  const clearInit = () => { clearTimeout(failsafe); clearTimeout(wakeMsg); };

  try {
    const params         = new URLSearchParams(window.location.search);
    const isMgrMode      = params.has(MGR_PARAM);
    const isSuperMgrMode = params.has(SUPER_MGR_PARAM);

    const ok = await initLoad();
    clearInit();

    if (!ok) { renderErrorScreen(); return; }

    if (isSuperMgrMode) { renderSuperMgrLogin(); return; }
    if (isMgrMode)      { renderManagerLogin();  return; }

    // ── Remembered user: skip name selection when possible ─────────
    const remembered = _loadRememberedUser();
    if (remembered) {
      // Validate: name must still exist on the roster
      const nameExists = S.names.some(n => normAr(n) === normAr(remembered));
      if (!nameExists) {
        _clearRememberedUser();
      } else {
        S.currentName = S.names.find(n => normAr(n) === normAr(remembered)) || remembered;

        if (S.isLocked) {
          startUserPoll();
          renderClosedScreen(S.currentName);
          return;
        }
        if (!S.orderingOpen) {
          startUserPoll();
          renderNotOpenScreen();
          return;
        }
        // Ordering is open. Has this person already ordered today?
        const existing = S.orders.find(o => normAr(o.name) === normAr(S.currentName));
        if (existing) {
          S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
          existing.items.forEach(i => {
            S.currentQty[i.name] = (S.currentQty[i.name] || 0) + i.qty;
            if (i.note) {
              S.currentNotes[i.name]   = i.note;
              S.currentNoteQty[i.name] = (S.currentNoteQty[i.name] || 0) + i.qty;
            }
          });
          startUserPoll();
          renderSubmittedScreen();
          return;
        }
        // No order today: offer repeat-last if available
        const last = _lastOrderFor(S.currentName);
        const repeatItems = (last || [])
          .filter(i => S.menuFlat.some(f => f.name === i.name))
          .map(i => ({ name: i.name, qty: i.qty, note: i.note, price: findPrice(i.name) }));
        if (repeatItems.length) {
          startUserPoll();
          renderRepeatScreen(S.currentName, repeatItems);
          return;
        }
        startUserPoll();
        renderOrderScreen(S.currentName);
        return;
      }
    }
    // ── No remembered user (or it was cleared) ────────────────────

    if (S.isLocked) {
      startUserPoll();
      renderClosedScreen(null);
    } else if (!S.orderingOpen) {
      startUserPoll();
      renderNotOpenScreen();
    } else {
      startUserPoll();
      renderNameScreen();
    }
  } catch (err) {
    clearInit();
    renderErrorScreen();
  }
}

/* ---------- CLICK DEBOUNCE ---------- */
let _lastClickTime = 0;
const NO_DEBOUNCE = new Set(['qty', 'editQty', 'toggleNote', 'toggleCat', 'toggleOC', 'noteQtyAdj', 'smToggleCat', 'smToggleItem', 'pickNote', 'mgrPickNote']);

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
      _clearRememberedUser();
      renderNameScreen();
      break;

    case 'goHome': goHome(); break;

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
    case 'mgrPickNote': {
      const id = parseInt(el.dataset.id, 10);
      mgrPickNoteSuggestion(id, el.dataset.note || '');
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
    case 'submitSameOrder': submitOrder();   break;
    case 'newOrderInstead': newOrderInstead(); break;
    case 'editMyOrder':    editMyOrder();    break;
    case 'orderForAnother': orderForAnother(); break;

    // Closed screen
    case 'lookupClosedOrder': lookupClosedOrder(); break;

    // Payment card
    case 'cashTap':
      showToast('روح ادفع بنفسك');
      break;

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
  if (e.target.classList.contains('mgr-note-input')) return;   // handled below
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

// Manager edit modal: typing in an item's note updates the edit state. Kept
// separate from the order-screen listener above so it writes S.editNotes, not
// S.currentNotes.
document.addEventListener('input', e => {
  if (!e.target.matches('.mgr-note-input')) return;
  chgEditNote(parseInt(e.target.dataset.id, 10), e.target.value);
});

// Set/clear the note for an item in the manager modal. A new note defaults to
// applying to every unit of that item; an existing partial split (2 of 3) is
// left alone unless the manager retypes.
function chgEditNote(id, value) {
  const item = S.menuFlat[id];
  if (!item) return;
  const raw = value || '';
  if (raw.trim()) {
    S.editNotes[item.name] = raw;
    if (S.editNoteQty[item.name] === undefined) S.editNoteQty[item.name] = S.editQty[item.name] || 0;
  } else {
    delete S.editNotes[item.name];
    delete S.editNoteQty[item.name];
  }
}

// Tapping a suggestion chip in the modal replaces the note text (never appends),
// mirroring the order screen.
function mgrPickNoteSuggestion(id, note) {
  const item = S.menuFlat[id];
  if (!item) return;
  const inp = document.getElementById(`mninput-${id}`);
  if (inp) inp.value = note;
  chgEditNote(id, note);
  const row = document.getElementById(`mnchips-${id}`);
  if (row) row.querySelectorAll('.note-chip').forEach(c =>
    c.classList.toggle('selected', c.dataset.note === note));
}

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

  // Remember the selected name for next visit (skip during proxy ordering:
  // the stored identity stays as the original person, per design).
  if (!S.orderedBy) _saveRememberedUser(name);

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
  // No order today: offer to repeat last time's order, if we have one whose
  // items still exist on today's menu (re-priced from today's menu).
  const last = _lastOrderFor(name);
  const repeatItems = (last || [])
    .filter(i => S.menuFlat.some(f => f.name === i.name))
    .map(i => ({ name: i.name, qty: i.qty, note: i.note, price: findPrice(i.name) }));
  if (repeatItems.length) { renderRepeatScreen(name, repeatItems); return; }
  renderOrderScreen(name);
}

// The person's last submitted order (kept across reset), matched by normalised
// name. Returns the items array, or null.
function _lastOrderFor(name) {
  if (!S.lastOrders) return null;
  const key = Object.keys(S.lastOrders).find(k => normAr(k) === normAr(name));
  return key ? S.lastOrders[key] : null;
}

// Restore last time's items into the working order, then show the repeat prompt.
function renderRepeatScreen(name, items) {
  S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {}; S.isDirty = false;
  items.forEach(i => {
    S.currentQty[i.name] = (S.currentQty[i.name] || 0) + i.qty;
    if (i.note) {
      S.currentNotes[i.name]   = i.note;
      S.currentNoteQty[i.name] = (S.currentNoteQty[i.name] || 0) + i.qty;
    }
  });
  document.getElementById('repeatName').textContent = `أهلاً ${name} 👋`;
  document.getElementById('repeatList').innerHTML = items.map(i => `
    <div class="summary-row">
      <span><span class="qty-tag">×${i.qty}</span>${h(i.name)}
        ${i.note ? `<span class="summary-note">📝 ${h(i.note)}</span>` : ''}</span>
      <span>${i.price * i.qty} جنيه</span>
    </div>`).join('');
  const foodTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('repeatTotalBox').innerHTML =
    `<div class="total-box"><div class="trow grand"><span>إجمالي الطعام</span><span>${foodTotal} جنيه</span></div></div>`;
  showScreen('screen-repeat');
}

function newOrderInstead() {
  S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {}; S.isDirty = false;
  renderOrderScreen(S.currentName);
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
function handleCancelOrder(el) {
  if (!S.currentName) return;
  showConfirm('متأكد مش هتطلب النهارده؟ الطلب هيتمسح نهائياً', async () => {
    var origText = el.textContent;
    el.textContent = 'جاري الإلغاء...';
    el.style.pointerEvents = 'none';
    try {
      await cancelOrder(S.currentName);
      S.orders = S.orders.filter(o => normAr(o.name) !== normAr(S.currentName));
      S.currentQty = {}; S.currentNotes = {}; S.currentNoteQty = {};
      S.isDirty = false; S.currentName = null;
      el.textContent = origText; el.style.pointerEvents = '';
      showToast('تم إلغاء طلبك ✓');
      setTimeout(renderNameScreen, 800);
    } catch (err) {
      el.textContent = origText; el.style.pointerEvents = '';
      showToast(err.message || 'مشكلة في الإلغاء');
    }
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
      S.isLocked = true; showToast('🔒 الطلبات اتقفلت!');
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

/* ---------- REMEMBERED USER (localStorage) ---------- */
// "Home" — return to the correct landing view for the CURRENT board state and
// clear the remembered user + any in-progress selection, so someone can hand
// their phone to a friend to look themselves up. It routes by state exactly like
// init() does after load, so it NEVER opens the ordering screen while ordering
// is closed: locked -> the closed screen's view-only lookup (see order + total,
// no adding); not yet open -> the not-open screen; open -> the name screen.
function goHome() {
  S.currentName    = null;
  S.currentQty     = {};
  S.currentNotes   = {};
  S.currentNoteQty = {};
  S.isDirty        = false;
  S.orderedBy      = null;
  _clearRememberedUser();

  if (S.isLocked) {
    renderClosedScreen(null);
  } else if (!S.orderingOpen) {
    renderNotOpenScreen();
  } else {
    renderNameScreen();
  }
}

// Lightweight "who uses this browser" — no auth, no password. Only the name
// string is stored; the actual order always comes from the server.
function _saveRememberedUser(name) {
  try { localStorage.setItem('fitar_user', name); } catch (e) {}
}
function _loadRememberedUser() {
  try { return localStorage.getItem('fitar_user') || null; } catch (e) { return null; }
}
function _clearRememberedUser() {
  try { localStorage.removeItem('fitar_user'); } catch (e) {}
}

/* ---------- DIRTY ORDER WARNING ---------- */
window.addEventListener('beforeunload', e => { if (S.isDirty) { e.preventDefault(); e.returnValue = ''; } });

window.addEventListener('load', () => {
  document.getElementById('editModal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
  document.getElementById('confirmModal').addEventListener('click', function(e) { if (e.target === this) cancelConfirm(); });
  init().catch(() => renderErrorScreen());
});