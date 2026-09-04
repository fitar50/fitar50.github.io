// ================================================================
// MANAGER DASHBOARD
// ================================================================

async function refreshManagerDashboard() {
  try {
    const [ordersR, namesR, statusR] = await Promise.all([
      api('getOrders'), api('getNames'), api('getStatus')
    ]);
    S.orders        = ordersR.data  || [];
    S.names         = namesR.data   || [];
    S.isLocked      = statusR.locked;
    S.lockTime      = statusR.lockTime;
    S.orderingOpen  = statusR.orderingOpen === true;
    renderManagerDashboard();
    document.getElementById('lastUpdated').textContent =
      'آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    showToast('فشل التحديث');
  }
}

function renderManagerDashboard() {
  const orders  = S.orders;
  const people  = orders.length;
  const delPP   = people > 0 ? DELIVERY_FEE / people : 0;
  let foodGrand = 0;
  orders.forEach(o => { foodGrand += o.items.reduce((s, i) => s + i.price * i.qty, 0); });
  const totalGrand = foodGrand + (people > 0 ? DELIVERY_FEE : 0);

  // Stats
  document.getElementById('sPeople').textContent = people;
  document.getElementById('sFood').textContent   = foodGrand;
  document.getElementById('sTotal').textContent  = totalGrand.toFixed(0);

  // Total summary — show each person's item as its own line (with notes), not aggregated
  const ts = document.getElementById('totalSummary');
  if (!orders.length) {
    ts.innerHTML = '<div class="ts-row" style="color:var(--grey);">لا يوجد طلبات حتى الآن</div>';
  } else {
    // Collect all item-instances across all orders, grouped by item name
    const grouped = {}; // { itemName: [{ qty, note, price }] }
    orders.forEach(o => {
      o.items.forEach(i => {
        if (!grouped[i.name]) grouped[i.name] = { price: i.price, instances: [] };
        grouped[i.name].instances.push({ qty: i.qty, note: i.note || '' });
      });
    });

    // Sort by total quantity descending
    const sortedNames = Object.keys(grouped).sort((a, b) => {
      const qa = grouped[a].instances.reduce((s, x) => s + x.qty, 0);
      const qb = grouped[b].instances.reduce((s, x) => s + x.qty, 0);
      return qb - qa;
    });

    let food = 0;
    let rowsHtml = '';
    sortedNames.forEach(itemName => {
      const g = grouped[itemName];
      g.instances.forEach(inst => {
        const sub = g.price * inst.qty;
        food += sub;
        const qtyLabel = inst.qty > 0 ? ` × ${inst.qty}` : '';
        rowsHtml += `<div class="ts-row"><span>${h(itemName)}${qtyLabel}</span><span>${sub} جنيه</span></div>`;
        if (inst.note) {
          rowsHtml += `<div class="ts-item-note">📝 ${h(inst.note)}</div>`;
        }
      });
    });

    ts.innerHTML = `
      <div class="ts-header">📦 الطلبات</div>
      ${rowsHtml}
      <div class="ts-row" style="color:var(--grey);font-size:13px;">
        <span>توصيل</span><span>${DELIVERY_FEE} جنيه</span>
      </div>
      <div class="ts-grand">
        <span>الإجمالي</span>
        <span>${(food + DELIVERY_FEE).toFixed(0)} جنيه</span>
      </div>
      <button class="copy-btn" id="copyOrderBtn" data-action="copyOrder">📋 نسخ الطلب للمطعم</button>`;
  }

  // Per-person cards
  const list = document.getElementById('ordersList');
  if (!orders.length) {
    list.innerHTML = '<div class="empty"><div class="e-icon">🍽️</div><p>لا يوجد طلبات بعد</p></div>';
  } else {
    list.innerHTML = '';
    orders.forEach(order => {
      const food  = order.items.reduce((s, i) => s + i.price * i.qty, 0);
      const total = food + delPP;
      const orderedByTag = (order.orderedBy && order.orderedBy !== order.name)
        ? `<div class="oc-ordered-by">بواسطة: ${h(order.orderedBy)}</div>` : '';

      // Build items HTML with notes
      const itemsHtml = order.items.map(i => {
        const noteRow = i.note
          ? `<div class="oc-item-note">📝 ${h(i.note)}</div>`
          : '';
        return `
          <div class="oc-item">
            <span>${h(i.name)} × ${i.qty}</span>
            <span>${i.price * i.qty} جنيه</span>
          </div>${noteRow}`;
      }).join('');

      const card = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div class="oc-header" data-action="toggleOC">
          <div class="oc-header-info">
            <div class="oc-name">${h(order.name)}</div>
            ${orderedByTag}
          </div>
          <div class="oc-header-controls">
            <span class="oc-total">${total.toFixed(2)} ج</span>
            <button class="oc-icon-btn" data-action="openModal"   data-name="${h(order.name)}" title="تعديل الطلب">✏️</button>
            <button class="oc-icon-btn oc-del" data-action="deleteOrder" data-name="${h(order.name)}" title="حذف الطلب">🗑️</button>
            <span class="cat-chevron">▼</span>
          </div>
        </div>
        <div class="oc-body">
          ${itemsHtml}
          <div class="oc-breakdown">
            <div class="oc-brow"><span>طعام</span><span>${food} جنيه</span></div>
            <div class="oc-brow"><span>توصيل (${people} أشخاص)</span><span>${delPP.toFixed(2)} جنيه</span></div>
            <div class="oc-brow grand"><span>الإجمالي</span><span>${total.toFixed(2)} جنيه</span></div>
          </div>
        </div>`;
      list.appendChild(card);
    });
  }

  // Manager person selector (for adding orders)
  fillNameDropdown('mgrPersonSel');

  // Names management section
  renderNamesManagement();

  // Actions section
  _renderMgrActions();
}

function _renderMgrActions() {
  const mgrActions = document.getElementById('mgrActions');
  if (S.isLocked) {
    mgrActions.innerHTML = `
      <div class="locked-badge">✅ الطلبات مقفولة — تم الإرسال ${S.lockTime}</div>
      <button class="btn btn-red" data-action="doReset">🔄 تصفير الطلبات</button>`;
    return;
  }

  // Not locked — show ordering toggle + lock + reset
  const toggleHtml = S.orderingOpen
    ? `<div class="ordering-open-badge">🟢 الطلبات مفتوحة للموظفين</div>
       <button class="btn btn-outline" style="color:#e65100;border-color:#e65100;background:#fff3e0;" data-action="doToggleOrdering">🔴 إغلاق الطلبات مؤقتاً</button>`
    : `<div class="ordering-closed-badge">🔴 الطلبات مش مفتوحة لسه</div>
       <button class="btn btn-green" data-action="doToggleOrdering">🟢 فتح الطلبات للموظفين</button>`;

  const lockHtml = S.orderingOpen
    ? `<button class="btn btn-primary" id="lockBtn" data-action="doLock">🔒 قفل الطلبات وإرسال للمطعم</button>`
    : '';

  mgrActions.innerHTML = `
    ${toggleHtml}
    ${lockHtml}
    <button class="btn btn-red" data-action="doReset">🔄 تصفير الطلبات</button>`;
}

/* ---------- NAMES MANAGEMENT ---------- */
function renderNamesManagement() {
  const container = document.getElementById('namesMgmtList');
  if (!container) return;

  if (!S.names.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--grey);font-size:13px;">لا يوجد أسماء مسجلة</div>';
    return;
  }

  container.innerHTML = '';
  S.names.forEach(name => {
    const hasOrder = S.orders.some(o => normAr(o.name) === normAr(name));
    const row = document.createElement('div');
    row.className = 'name-mgmt-row';
    row.innerHTML = `
      <span class="name-mgmt-label">
        ${h(name)}
        ${hasOrder ? '<span class="name-has-order">✓ طلب</span>' : ''}
      </span>
      <button class="oc-icon-btn oc-del" data-action="deleteName" data-name="${h(name)}" title="مسح الاسم">🗑️</button>`;
    container.appendChild(row);
  });
}

async function doDeleteName(name, btn) {
  const hasOrder = S.orders.some(o => normAr(o.name) === normAr(name));
  const msg = hasOrder
    ? `هتمسح "${name}" من الأسماء — طلبهم هيفضل موجود في القايمة. تأكيد؟`
    : `هتمسح "${name}" من قايمة الأسماء نهائياً؟`;
  showConfirm(msg, async () => {
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      await api('deleteName', { name, ref: S.mgrKey });
      S.names = S.names.filter(n => n !== name);
      showToast('تم مسح الاسم ✓');
      renderManagerDashboard();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      showToast(e.message || 'فشل مسح الاسم ❌');
    }
  });
}

// Manager adds a name to the permanent list
async function mgrAddNewName() {
  const inp  = document.getElementById('mgrNewNameInput');
  const name = inp ? inp.value.trim() : '';
  if (!name) { showToast('اكتب الاسم'); return; }
  if (S.names.some(n => normAr(n) === normAr(name))) {
    showToast('الاسم موجود بالفعل'); return;
  }
  try {
    await api('addName', { name, ref: S.mgrKey });
    S.names.push(name);
    if (inp) inp.value = '';
    showToast('تم إضافة الاسم ✓');
    renderManagerDashboard();
  } catch (e) {
    showToast(e.message || 'فشل إضافة الاسم ❌');
  }
}

// Copy-to-clipboard text for the restaurant — includes notes
function buildRestaurantText() {
  // Collect instances grouped by item
  const grouped = {};
  S.orders.forEach(o => {
    o.items.forEach(i => {
      if (!grouped[i.name]) grouped[i.name] = [];
      grouped[i.name].push({ qty: i.qty, note: i.note || '' });
    });
  });

  const lines = [];
  Object.entries(grouped).forEach(([name, instances]) => {
    instances.forEach(inst => {
      const qtyLabel = inst.qty > 0 ? ` × ${inst.qty}` : '';
      const notePart = inst.note ? ` (${inst.note})` : '';
      lines.push(`${name}${qtyLabel}${notePart}`);
    });
  });

  const totalItems = S.orders.reduce((t, o) => t + o.items.reduce((s, i) => s + i.qty, 0), 0);
  return `طلب فطار الشغل:\n${lines.join('\n')}\n\nالإجمالي: ${totalItems} صنف + توصيل ${DELIVERY_FEE} ج`;
}

/* ---------- ORDERING TOGGLE ---------- */
async function doToggleOrdering() {
  const newState = !S.orderingOpen;
  const msg = newState
    ? 'هتفتح الطلبات للموظفين؟'
    : 'هتقفل الطلبات مؤقتاً؟ الموظفين مش هيقدروا يطلبوا.';

  showConfirm(msg, async () => {
    try {
      await api('setOrderingStatus', { enabled: newState, ref: S.mgrKey });
      S.orderingOpen = newState;
      showToast(newState ? 'الطلبات اتفتحت ✓' : 'الطلبات اتقفلت مؤقتاً ✓');
      _renderMgrActions();
    } catch (e) {
      showToast(e.message || 'فشل العملية ❌');
    }
  });
}

/* ---------- EDIT MODAL ---------- */
function openModal(name) {
  S.editName = name;
  const order = S.orders.find(o => o.name === name);
  S.editQty   = {};
  S.editNotes = {};   // preserve existing per-item notes through the edit
  if (order) order.items.forEach(i => {
    S.editQty[i.name] = i.qty;
    if (i.note) S.editNotes[i.name] = i.note;
  });

  document.getElementById('modalTitle').textContent = `تعديل طلب ${h(name)}`;
  renderModal();
  document.getElementById('editModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('editModal').style.display = 'none';
  document.body.style.overflow = '';
  S.editName  = null;
  S.editQty   = {};
  S.editNotes = {};
}

function renderModal() {
  const body = document.getElementById('modalBody');
  body.innerHTML = '';

  Object.entries(S.menu).forEach(([cat, items]) => {
    const selCount = items.filter(i => (S.editQty[i.name] || 0) > 0).length;
    const block = document.createElement('div');
    block.className = 'category-block' + (selCount > 0 ? ' open' : '');

    let itemsHtml = '';
    items.forEach(item => {
      const fi  = S.menuFlat.find(f => f.name === item.name);
      const id  = fi ? fi.id : 0;
      const qty = S.editQty[item.name] || 0;
      itemsHtml += `
        <div class="item-row">
          <div class="item-info">
            <div class="item-name">${h(item.name)}</div>
            <div class="item-price">${item.price} جنيه</div>
          </div>
          <div class="qty">
            <button class="qty-btn minus" data-action="editQty" data-id="${id}" data-delta="-1">−</button>
            <div class="qty-num ${qty > 0 ? 'nonzero' : ''}" id="mqn-${id}">${qty}</div>
            <button class="qty-btn plus"  data-action="editQty" data-id="${id}" data-delta="+1">+</button>
          </div>
        </div>`;
    });

    block.innerHTML = `
      <div class="cat-header" data-action="toggleCat">
        <span class="cat-title">${h(cat)}</span>
        <div class="cat-right">
          <span class="cat-badge ${selCount ? 'show' : ''}" id="mbadge-${h(cat)}">${selCount}</span>
          <span class="cat-chevron">▼</span>
        </div>
      </div>
      <div class="cat-items">${itemsHtml}</div>`;
    body.appendChild(block);
  });
}

function chgEditQty(id, delta) {
  const item = S.menuFlat[id];
  const cur  = S.editQty[item.name] || 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) delete S.editQty[item.name];
  else S.editQty[item.name] = next;

  const el = document.getElementById(`mqn-${id}`);
  el.textContent = next;
  el.classList.toggle('nonzero', next > 0);

  const items = S.menu[item.category] || [];
  const count = items.filter(i => (S.editQty[i.name] || 0) > 0).length;
  const badge = document.getElementById(`mbadge-${item.category}`);
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }
}

async function saveModal() {
  const items = Object.entries(S.editQty)
    .filter(([, q]) => q > 0)
    .map(([name, qty]) => {
      const obj = { name, qty, price: findPrice(name) };
      if (S.editNotes && S.editNotes[name]) obj.note = S.editNotes[name];
      return obj;
    });

  if (!items.length) {
    showConfirm(`هتمسح طلب ${S.editName} بالكامل؟`, () => {
      _doSaveModal(items);
    });
    return;
  }
  await _doSaveModal(items);
}

async function _doSaveModal(items) {
  const saveBtn = document.getElementById('modalSaveBtn');
  setBtnLoading(saveBtn, 'جاري الحفظ');
  try {
    await api('mgr_update', { data: { name: S.editName, items }, ref: S.mgrKey });

    const idx = S.orders.findIndex(o => o.name === S.editName);
    if (items.length === 0) {
      if (idx !== -1) S.orders.splice(idx, 1);
    } else if (idx !== -1) {
      S.orders[idx].items = items;
    } else {
      S.orders.push({ name: S.editName, items });
    }

    closeModal();
    renderManagerDashboard();
    showToast('تم الحفظ ✓');
  } catch (e) {
    showToast(e.message || 'فشل الحفظ ❌');
  } finally {
    if (saveBtn) resetBtn(saveBtn);
  }
}

/* ---------- MANAGER ACTIONS ---------- */
async function doManagerLogin() {
  const code = document.getElementById('mgrCodeInput').value.trim();
  if (!code) { showToast('ادخل الكود'); return; }

  const btn = document.querySelector('#screen-mgr-login .btn');
  setBtnLoading(btn, 'جاري التحقق');

  try {
    const res = await api('verify', { ref: code });
    if (!res.success) {
      showToast('بس يا بابا. بلاش لعب');
      resetBtn(btn);
      return;
    }
    S.mgrKey = code;
    stopUserPoll();
    await refreshManagerDashboard();
    showScreen('screen-manager');
    S.mgrRefreshTimer = setInterval(refreshManagerDashboard, 10000);
  } catch (e) {
    showToast('خطأ في الاتصال ❌');
    resetBtn(btn);
  }
}

function exitManager() {
  if (S.mgrRefreshTimer) {
    clearInterval(S.mgrRefreshTimer);
    S.mgrRefreshTimer = null;
  }
  S.mgrKey = null;
  api('getStatus').then(r => {
    S.isLocked     = r.locked;
    S.lockTime     = r.lockTime;
    S.orderingOpen = r.orderingOpen === true;
    if (S.isLocked) {
      renderClosedScreen(null);
    } else if (!S.orderingOpen) {
      startUserPoll();
      renderNotOpenScreen();
    } else {
      startUserPoll();
      renderNameScreen();
    }
  }).catch(() => {
    startUserPoll();
    renderNameScreen();
  });
}

function doLock() {
  showConfirm('هتقفل الطلبات؟ مش هيقدر حد يعدل أو يضيف بعد كده.', async () => {
    const btn = document.getElementById('lockBtn');
    if (btn) setBtnLoading(btn, 'جاري القفل');
    try {
      await api('lock', { ref: S.mgrKey });
      S.isLocked = true;
      showToast('تم قفل الطلبات ✓');
      await refreshManagerDashboard();
    } catch (e) {
      showToast(e.message || 'فشل القفل ❌');
      if (btn) resetBtn(btn);
    }
  });
}

function doReset() {
  showConfirm('هتمسح كل الطلبات النهارده؟ العملية مش هترجع!', async () => {
    try {
      await api('reset', { ref: S.mgrKey });
      S.orders       = [];
      S.isLocked     = false;
      S.orderingOpen = false;
      showToast('تم التصفير ✓');
      renderManagerDashboard();
    } catch (e) {
      showToast(e.message || 'فشل التصفير ❌');
    }
  });
}

function doDeleteOrder(name, btn) {
  showConfirm(`هتحذف طلب "${name}"؟`, async () => {
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      await api('mgr_delete', { name, ref: S.mgrKey });
      S.orders = S.orders.filter(o => o.name !== name);
      showToast('تم الحذف ✓');
      renderManagerDashboard();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      showToast(e.message || 'فشل الحذف ❌');
    }
  });
}

async function mgrAddPerson() {
  const sel  = document.getElementById('mgrPersonSel');
  const name = sel.value || '';
  if (!name) { showToast('اختار اسم من القايمة'); return; }
  sel.value = '';
  openModal(name);
}
