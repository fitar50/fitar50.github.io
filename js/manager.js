// ================================================================
// MANAGER DASHBOARD
// ================================================================

async function refreshManagerDashboard() {
  try {
    // getOrdersAdmin (not the public getOrders) so we get `paid`.
    // getNamesAdmin so the collector picker can autofill InstaPay numbers.
    const [ordersR, namesR, namesAdminR, statusR, restR] = await Promise.all([
      api('getOrdersAdmin', { ref: S.mgrKey }),
      api('getNames'),
      // Non-fatal: this only powers InstaPay autofill. If it fails (e.g. the
      // backend hasn't been redeployed yet) the dashboard must still work.
      api('getNamesAdmin',  { ref: S.mgrKey }).catch(() => ({ data: [] })),
      api('getStatus'),
      api('getRestaurants')
    ]);
    S.orders             = ordersR.data     || [];
    S.names              = namesR.data      || [];
    S.namesAdmin         = namesAdminR.data || [];
    S.isLocked           = statusR.locked;
    S.lockTime           = statusR.lockTime;
    S.orderingOpen       = statusR.orderingOpen === true;
    S.activeRestaurantId = statusR.activeRestaurantId || null;
    S.paymentInfo        = statusR.paymentInfo || S.paymentInfo;
    S.deliveryFee        = typeof statusR.deliveryFee === 'number' ? statusR.deliveryFee : 0;
    S.deliveryOverride   = statusR.deliveryOverride || '';
    S.restaurants        = restR.data || [];
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
  // Bug 9.5: exact per-person shares that sum to the fee (no piaster lost).
  const shares  = deliverySplit(S.deliveryFee, people);
  let foodGrand = 0;
  orders.forEach(o => { foodGrand += o.items.reduce((s, i) => s + i.price * i.qty, 0); });
  const totalGrand = foodGrand + (people > 0 ? S.deliveryFee : 0);   // exact — owed to the restaurant
  // Rounding: each person pays a clean amount; only people pay rounded, never
  // the restaurant. `collected` is what actually comes in; `surplus` (can be
  // negative) is the gap the manager is left holding or short.
  const roundedTotals = orders.map((o, idx) =>
    roundPersonTotal(o.items.reduce((s, i) => s + i.price * i.qty, 0) + shares[idx]));
  const collected = roundedTotals.reduce((a, b) => a + b, 0);
  const surplus   = collected - totalGrand;

  document.getElementById('sPeople').textContent = people;
  document.getElementById('sFood').textContent   = foodGrand;
  document.getElementById('sTotal').textContent  = totalGrand.toFixed(0);

  // ── Restaurant + Payment config section ──
  _renderMgrConfig();

  // ── Total summary ──
  const ts = document.getElementById('totalSummary');
  if (!orders.length) {
    ts.innerHTML = '<div class="ts-row" style="color:var(--grey);">لا يوجد طلبات حتى الآن</div>';
  } else {
    const grouped = {};
    orders.forEach(o => {
      o.items.forEach(i => {
        const key = i.name + '\x00' + (i.note || '');
        if (!grouped[key]) grouped[key] = { name: i.name, note: i.note || '', price: i.price, qty: 0 };
        grouped[key].qty += i.qty;
      });
    });
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const diff = grouped[b].qty - grouped[a].qty;
      return diff !== 0 ? diff : grouped[a].name.localeCompare(grouped[b].name);
    });
    let food = 0;
    let rowsHtml = '';
    sortedKeys.forEach(key => {
      const g = grouped[key];
      const sub = g.price * g.qty;
      food += sub;
      const label = g.note ? `${h(g.name)} — ${h(g.note)}` : h(g.name);
      rowsHtml += `<div class="ts-row"><span>${label} × ${g.qty}</span><span>${sub} جنيه</span></div>`;
    });
    ts.innerHTML = `
      <div class="ts-header">📦 الطلبات</div>
      ${rowsHtml}
      <div class="ts-row" style="color:var(--grey);font-size:13px;">
        <span>توصيل</span><span>${S.deliveryFee} جنيه</span>
      </div>
      <div class="ts-grand">
        <span>للمطعم (الفعلي)</span>
        <span>${(food + S.deliveryFee).toFixed(0)} جنيه</span>
      </div>
      <div class="ts-row"><span>هيتجمع من الناس</span><span>${collected.toFixed(0)} جنيه</span></div>
      ${
        surplus > 0.005
          ? `<div class="ts-row ts-surplus"><span>زيادة التقريب</span><span>+${surplus.toFixed(2)} جنيه</span></div>`
          : surplus < -0.005
            ? `<div class="ts-row ts-short"><span>ناقص التقريب</span><span>${surplus.toFixed(2)} جنيه</span></div>`
            : ''
      }
      <button class="copy-btn" id="copyOrderBtn" data-action="copyOrder">📋 نسخ الطلب للمطعم</button>`;
  }

  // ── Per-person cards ──
  _renderPaidSummary(people, shares);

  const list = document.getElementById('ordersList');
  const openNames = new Set();
  list.querySelectorAll('.order-card.open .oc-name').forEach(el => openNames.add(el.textContent.trim()));
  try {
    const saved = JSON.parse(localStorage.getItem('mgrOpenCards') || '[]');
    saved.forEach(n => openNames.add(n));
  } catch (e) {}

  if (!orders.length) {
    list.innerHTML = '<div class="empty"><div class="e-icon">🍽️</div><p>لا يوجد طلبات بعد</p></div>';
    try { localStorage.removeItem('mgrOpenCards'); } catch (e) {}
  } else {
    list.innerHTML = '';
    orders.forEach((order, idx) => {
      const food  = order.items.reduce((s, i) => s + i.price * i.qty, 0);
      const delShare = shares[idx];
      const total = food + delShare;          // exact
      const rounded = roundedTotals[idx];     // what this person actually pays
      const orderedByTag = (order.orderedBy && order.orderedBy !== order.name)
        ? `<div class="oc-ordered-by">بواسطة: ${h(order.orderedBy)}</div>` : '';
      const itemsHtml = order.items.map(i => {
        const noteRow = i.note ? `<div class="oc-item-note">📝 ${h(i.note)}</div>` : '';
        return `<div class="oc-item"><span>${h(i.name)} × ${i.qty}</span><span>${i.price * i.qty} جنيه</span></div>${noteRow}`;
      }).join('');
      const isOpen = openNames.has(order.name);
      const card = document.createElement('div');
      card.className = 'order-card' + (isOpen ? ' open' : '') + (order.paid ? ' is-paid' : '');
      card.innerHTML = `
        <div class="oc-header" data-action="toggleOC">
          <div class="oc-header-info">
            <div class="oc-name">${h(order.name)}</div>
            ${orderedByTag}
          </div>
          <div class="oc-header-controls">
            <span class="oc-total">${rounded.toFixed(0)} ج</span>
            <button class="oc-icon-btn oc-paid${order.paid ? ' is-paid' : ''}" data-action="togglePaid" data-name="${h(order.name)}" data-paid="${order.paid ? '1' : '0'}" title="${order.paid ? 'مدفوع' : 'لسه مدفعش'}">${order.paid ? '✅' : '⭕'}</button>
            <button class="oc-icon-btn" data-action="openModal"   data-name="${h(order.name)}" title="تعديل الطلب">✏️</button>
            <button class="oc-icon-btn oc-del" data-action="deleteOrder" data-name="${h(order.name)}" title="حذف الطلب">🗑️</button>
            <span class="cat-chevron">▼</span>
          </div>
        </div>
        <div class="oc-body${isOpen ? ' open' : ''}">
          ${itemsHtml}
          <div class="oc-breakdown">
            <div class="oc-brow"><span>طعام</span><span>${food} جنيه</span></div>
            <div class="oc-brow"><span>توصيل (${people} أشخاص)</span><span>${delShare.toFixed(2)} جنيه</span></div>
            <div class="oc-brow"><span>الفعلي</span><span>${total.toFixed(2)} جنيه</span></div>
            <div class="oc-brow grand"><span>للتحصيل</span><span>${rounded.toFixed(0)} جنيه</span></div>
          </div>
        </div>`;
      list.appendChild(card);
    });
    try { localStorage.setItem('mgrOpenCards', JSON.stringify([...openNames])); } catch (e) {}
  }

  fillNameDropdown('mgrPersonSel');
  renderNamesManagement();
  _renderMgrActions();
}

// ── Config section: restaurant, delivery fee, collector, payment ──────────
// NOTE: this card is rebuilt by the 10s auto-refresh. Every input's current
// value is read BEFORE the rebuild and restored, otherwise the manager cannot
// finish typing a phone number.
function _renderMgrConfig() {
  const section = document.getElementById('mgrConfigSection');
  if (!section) return;

  // The dashboard auto-refreshes every 10s. Rewriting innerHTML destroys the
  // focused element, so a manager halfway through typing a phone number gets
  // the cursor yanked out. Values were already preserved; focus was not.
  // Skip the rebuild entirely while a field in this card has focus.
  const ae = document.activeElement;
  if (ae && ae !== document.body && section.contains(ae) &&
      /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;

  const pi = S.paymentInfo || {};
  const knownNames = (S.namesAdmin || []).map(n => n.name);

  // Preserve in-progress input across the auto-refresh
  const curCollector = document.getElementById('collectorSel')?.value
    ?? (pi.collectorName && knownNames.includes(pi.collectorName) ? pi.collectorName
        : (pi.collectorName ? '__other__' : ''));
  const curOtherName = document.getElementById('collectorOtherName')?.value
    ?? (pi.collectorName && !knownNames.includes(pi.collectorName) ? pi.collectorName : '');
  const curCash      = document.getElementById('payCash')?.checked      ?? !!pi.paymentCash;
  const curInstapay  = document.getElementById('payInstapay')?.checked   ?? !!pi.paymentInstapay;
  const curNumber    = document.getElementById('instapayNumInp')?.value  ?? (pi.instapayNumber || '');
  const curOverride  = document.getElementById('feeOverrideInp')?.value  ?? (S.deliveryOverride || '');

  const activeRest  = S.restaurants.find(r => r.id === S.activeRestaurantId);
  const hasOrders   = S.orders.length > 0;
  const restOptions = S.restaurants
    .map(r => `<option value="${r.id}" ${r.id === S.activeRestaurantId ? 'selected' : ''}>${h(r.name)}</option>`)
    .join('');

  const collectorOptions = knownNames
    .map(n => `<option value="${h(n)}" ${curCollector === n ? 'selected' : ''}>${h(n)}</option>`)
    .join('');

  const isOther     = curCollector === '__other__';
  const hasOverride = String(S.deliveryOverride || '') !== '';

  section.innerHTML = `
    <div class="mgr-config-card">

      ${activeRest
        ? `<div class="cfg-active-rest">🏪 مطعم اليوم: <strong>${h(activeRest.name)}</strong></div>`
        : `<div class="cfg-active-rest" style="border-color:#ffcdd2;background:#fff5f5;color:#c62828;">⚠️ لم يتم اختيار مطعم بعد</div>`}

      <!-- Restaurant. Locked while orders exist: orders store a price snapshot,
           so switching would strand them on a menu that no longer applies. -->
      <div class="cfg-row">
        <span class="cfg-label">مطعم اليوم</span>
        <div class="cfg-sel-row">
          <div class="sel-wrap" style="flex:1;">
            <select id="restaurantSel" ${hasOrders ? 'disabled' : ''}>
              <option value="">-- اختار --</option>
              ${restOptions}
            </select>
          </div>
          <button class="sm-add-btn" data-action="doSetRestaurant" ${hasOrders ? 'disabled' : ''}>تأكيد ✓</button>
        </div>
        ${hasOrders ? `<div class="cfg-hint">اعمل تصفير الطلبات عشان تغير المطعم</div>` : ''}
      </div>

      <!-- Delivery fee -->
      <div class="cfg-row">
        <span class="cfg-label">رسوم التوصيل</span>
        <div class="cfg-fee-line">
          <strong>${S.deliveryFee} ج</strong>
          <span class="cfg-fee-src">${hasOverride ? '(تعديل اليوم)' : '(من المطعم)'}</span>
        </div>
        <div class="cfg-sel-row" style="margin-top:6px;">
          <input id="feeOverrideInp" type="number" min="0" inputmode="numeric"
            class="cfg-text-input" style="flex:1;" placeholder="تعديل لليوم" value="${h(String(curOverride))}">
          <button class="sm-add-btn" data-action="doSaveFeeOverride">حفظ</button>
          ${hasOverride ? `<button class="sm-add-btn" style="background:#c62828;" data-action="doClearFeeOverride">إلغاء</button>` : ''}
        </div>
      </div>

      <!-- Collector -->
      <div class="cfg-row">
        <span class="cfg-label">المسؤول عن تحصيل الفلوس</span>
        <div class="sel-wrap">
          <select id="collectorSel">
            <option value="">-- اختار --</option>
            ${collectorOptions}
            <option value="__other__" ${isOther ? 'selected' : ''}>➕ شخص آخر</option>
          </select>
        </div>
        <div id="collectorOtherWrap" style="${isOther ? '' : 'display:none;'}margin-top:8px;">
          <input id="collectorOtherName" type="text" class="cfg-text-input"
            placeholder="اسم المسؤول" maxlength="30" value="${h(curOtherName)}">
        </div>
      </div>

      <!-- Payment methods -->
      <div class="cfg-row">
        <span class="cfg-label">طريقة الدفع</span>
        <div class="cfg-check-row">
          <label class="cfg-check-label"><input type="checkbox" id="payCash" ${curCash ? 'checked' : ''}> كاش</label>
          <label class="cfg-check-label"><input type="checkbox" id="payInstapay" ${curInstapay ? 'checked' : ''}> إنستاباي</label>
        </div>
      </div>

      <div class="cfg-row" id="instapayRow" ${curInstapay ? '' : 'style="display:none"'}>
        <span class="cfg-label">لينك الإنستاباي</span>
        <input id="instapayNumInp" type="url" placeholder="https://ipn.eg/S/..." maxlength="120"
          class="cfg-text-input" style="direction:ltr;text-align:left;font-size:13px;" value="${h(curNumber)}">
      </div>

      <button class="btn btn-primary" style="width:100%;margin-top:4px;" data-action="doSavePayment">
        💾 حفظ إعدادات الدفع
      </button>
      <div class="cfg-hint" style="text-align:center;">تقدر تغير المسؤول في أي وقت، حتى بعد القفل</div>
    </div>`;
}

// Autofills the saved InstaPay number when a known person is picked.
function onCollectorChange() {
  const sel  = document.getElementById('collectorSel');
  const wrap = document.getElementById('collectorOtherWrap');
  if (!sel) return;
  const isOther = sel.value === '__other__';
  if (wrap) wrap.style.display = isOther ? '' : 'none';

  if (!isOther && sel.value) {
    const rec = (S.namesAdmin || []).find(n => n.name === sel.value);
    const inp = document.getElementById('instapayNumInp');
    if (rec && inp) inp.value = rec.instapay_number || '';
  }
}

async function doSetRestaurant() {
  const id = parseInt(document.getElementById('restaurantSel')?.value);
  if (!id) { showToast('اختار مطعم'); return; }
  if (id === S.activeRestaurantId) { showToast('ده نفس المطعم اللي شغال'); return; }

  const btn = document.querySelector('[data-action="doSetRestaurant"]');
  if (btn) setBtnLoading(btn, 'جاري التحديث');
  try {
    // The server refuses the switch while orders exist and returns the Arabic
    // reason. No confirm dialog here: the switch is blocked, not risky.
    await api('setActiveRestaurant', { id, ref: S.mgrKey });
    S.activeRestaurantId = id;
    const r = await api('getMenu');
    S.menu = r.data || {};
    buildMenuFlat();
    const st = await api('getStatus');
    S.deliveryFee = typeof st.deliveryFee === 'number' ? st.deliveryFee : 0;
    showToast('تم تحديد المطعم ✓');
    renderManagerDashboard();
  } catch (e) {
    showToast(e.message || 'فشل تحديد المطعم ❌');
  } finally {
    const b = document.querySelector('[data-action="doSetRestaurant"]');
    if (b) resetBtn(b);
  }
}

async function doSaveFeeOverride() {
  const raw = document.getElementById('feeOverrideInp')?.value.trim() || '';
  if (raw === '') { showToast('اكتب رقم أو اضغط إلغاء'); return; }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== raw) { showToast('رقم غلط'); return; }

  const btn = document.querySelector('[data-action="doSaveFeeOverride"]');
  if (btn) setBtnLoading(btn, '...');
  try {
    await api('setDeliveryOverride', { value: n, ref: S.mgrKey });
    S.deliveryOverride = String(n);
    S.deliveryFee      = n;
    showToast('تم تعديل رسوم التوصيل ✓');
    renderManagerDashboard();
  } catch (e) { showToast(e.message || 'فشل التعديل ❌');
  } finally { const b = document.querySelector('[data-action="doSaveFeeOverride"]'); if (b) resetBtn(b); }
}

async function doClearFeeOverride() {
  try {
    await api('setDeliveryOverride', { value: null, ref: S.mgrKey });
    S.deliveryOverride = '';
    // Blank the field too, otherwise the preserve-input logic re-renders the
    // old number and it looks like the override is still active.
    const inp = document.getElementById('feeOverrideInp');
    if (inp) inp.value = '';
    const st = await api('getStatus');
    S.deliveryFee = typeof st.deliveryFee === 'number' ? st.deliveryFee : 0;
    showToast('رجعنا لرسوم المطعم ✓');
    renderManagerDashboard();
  } catch (e) { showToast(e.message || 'فشل الإلغاء ❌'); }
}

async function doSavePayment() {
  const sel      = document.getElementById('collectorSel');
  const selVal   = sel ? sel.value : '';
  const isOther  = selVal === '__other__';
  const collectorName = isOther
    ? (document.getElementById('collectorOtherName')?.value.trim() || '')
    : selVal;
  const paymentCash     = document.getElementById('payCash')?.checked     || false;
  const paymentInstapay = document.getElementById('payInstapay')?.checked || false;
  const instapayNumber  = document.getElementById('instapayNumInp')?.value.trim() || '';

  if (!selVal)                            { showToast('اختار المسؤول عن التحصيل'); return; }
  if (isOther && !collectorName)          { showToast('اكتب اسم المسؤول');        return; }
  if (!paymentCash && !paymentInstapay)   { showToast('اختار طريقة دفع');          return; }
  if (paymentInstapay && !instapayNumber) { showToast('ادخل رقم الإنستاباي');      return; }

  const btn = document.querySelector('[data-action="doSavePayment"]');
  if (btn) setBtnLoading(btn, 'جاري الحفظ');
  try {
    // isKnownName tells the server whether to remember this number on the
    // person's record. Ad-hoc collectors are never added to the names list.
    await api('setPaymentInfo', {
      data: { collectorName, isKnownName: !isOther, paymentCash, paymentInstapay, instapayNumber },
      ref:  S.mgrKey
    });
    S.paymentInfo = { collectorName, paymentCash, paymentInstapay, instapayNumber };
    if (!isOther) {
      const rec = (S.namesAdmin || []).find(n => n.name === collectorName);
      if (rec && paymentInstapay) rec.instapay_number = instapayNumber;
    }
    showToast('تم حفظ إعدادات الدفع ✓');
  } catch (e) {
    showToast(e.message || 'فشل حفظ إعدادات الدفع ❌');
  } finally {
    const b = document.querySelector('[data-action="doSavePayment"]');
    if (b) resetBtn(b);
  }
}

// ── Payment tracking (MANAGER ONLY) ───────────────────────────────────────
// Never render this anywhere outside #screen-manager, and never put it in
// buildRestaurantText(). The whole point is that other people cannot see it.
function _renderPaidSummary(people, shares) {
  const el = document.getElementById('paidSummary');
  if (!el) return;
  if (!S.orders.length) { el.innerHTML = ''; el.style.display = 'none'; return; }

  const paidCount = S.orders.filter(o => o.paid).length;
  let outstanding = 0;
  S.orders.forEach((o, idx) => {
    if (o.paid) return;
    outstanding += roundPersonTotal(o.items.reduce((sum, i) => sum + i.price * i.qty, 0) + shares[idx]);
  });

  el.style.display = 'block';
  el.innerHTML = paidCount === S.orders.length
    ? `<div class="paid-summary all-paid">🎉 الكل دفع</div>`
    : `<div class="paid-summary">💰 دفع ${paidCount} من ${S.orders.length}
         <span class="paid-outstanding">متبقي ${outstanding.toFixed(0)} ج</span></div>`;
}

async function doTogglePaid(name, currentlyPaid, btn) {
  const next = !currentlyPaid;
  if (btn) btn.disabled = true;
  try {
    await api('setPaid', { name, paid: next, ref: S.mgrKey });
    const o = S.orders.find(x => x.name === name);
    if (o) o.paid = next;
    renderManagerDashboard();
  } catch (e) {
    if (btn) btn.disabled = false;
    showToast(e.message || 'فشل التحديث ❌');
  }
}

// ── Names management ─────────────────────────────────────────────
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

async function mgrAddNewName() {
  const inp  = document.getElementById('mgrNewNameInput');
  const name = inp ? inp.value.trim() : '';
  if (!name) { showToast('اكتب الاسم'); return; }
  if (S.names.some(n => normAr(n) === normAr(name))) { showToast('الاسم موجود بالفعل'); return; }
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

// ── Copy to clipboard ────────────────────────────────────────────
// Always call refreshManagerDashboard() (or re-fetch) before this. The string
// it produces is the actual instruction to the kitchen, so it must not be built
// from a copy that may be up to 10 seconds stale.
function buildRestaurantText() {
  const grouped = {};
  S.orders.forEach(o => {
    o.items.forEach(i => {
      const key = i.name + '\x00' + (i.note || '');
      if (!grouped[key]) grouped[key] = { name: i.name, note: i.note || '', qty: 0 };
      grouped[key].qty += i.qty;
    });
  });
  const lines = Object.values(grouped).map(g =>
    g.note ? `${g.name} (${g.note}) × ${g.qty}` : `${g.name} × ${g.qty}`
  );
  const totalItems = S.orders.reduce((t, o) => t + o.items.reduce((s, i) => s + i.qty, 0), 0);
  return `طلب فطار الشغل:\n${lines.join('\n')}\n\nالإجمالي: ${totalItems} صنف + توصيل ${S.deliveryFee} ج`;
}

// ── Ordering toggle ──────────────────────────────────────────────
async function doToggleOrdering() {
  const newState = !S.orderingOpen;
  if (newState && !S.activeRestaurantId) {
    showToast('اختار مطعم الأول قبل ما تفتح الطلبات');
    return;
  }
  // Soft warning, not a block: the collector can legitimately be decided after
  // ordering opens. But without one, users see no payment box at all, which
  // defeats the point of the app.
  const noCollector = newState && !(S.paymentInfo && S.paymentInfo.collectorName);
  const msg = newState
    ? (noCollector
        ? 'لسه محددتش المسؤول عن التحصيل — الناس مش هتعرف تدفع لمين. تفتح الطلبات برضه؟'
        : 'هتفتح الطلبات للموظفين؟')
    : 'هتقفل الطلبات مؤقتاً؟ الموظفين مش هيقدروا يطلبوا.';
  showConfirm(msg, async () => {
    try {
      await api('setOrderingStatus', { enabled: newState, ref: S.mgrKey });
      S.orderingOpen = newState;
      showToast(newState ? 'الطلبات اتفتحت ✓' : 'الطلبات اتقفلت مؤقتاً ✓');
      _renderMgrActions();
    } catch (e) { showToast(e.message || 'فشل العملية ❌'); }
  });
}

function _renderMgrActions() {
  const mgrActions = document.getElementById('mgrActions');
  if (S.isLocked) {
    mgrActions.innerHTML = `
      <div class="locked-badge">✅ الطلبات مقفولة — تم الإرسال ${S.lockTime}</div>
      <button class="btn btn-red" data-action="doReset">🔄 تصفير الطلبات</button>`;
    return;
  }
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
    <button class="btn btn-red" data-action="doReset">🔄 تصفير الطلبات</button>
    <div style="border-top:1px solid #eee;margin-top:12px;padding-top:12px;">
      <button class="btn btn-outline" style="width:100%;font-size:13px;" data-action="showSuperMgrFromMgr">
        ⚙️ إدارة المطاعم والقوائم (سوبر مدير)
      </button>
    </div>`;
}

// ── Edit modal ───────────────────────────────────────────────────
function openModal(name) {
  S.editName = name;
  const order = S.orders.find(o => o.name === name);
  S.editQty = {}; S.editNotes = {}; S.editNoteQty = {};
  if (order) order.items.forEach(i => {
    S.editQty[i.name] = (S.editQty[i.name] || 0) + i.qty;
    if (i.note) {
      S.editNotes[i.name] = i.note;
      // How many of this item carry the note. An order split by a partial note
      // ("2 with ketchup, 1 plain") arrives as two entries with the same name;
      // without tracking this, saving would apply the note to all 3.
      S.editNoteQty[i.name] = (S.editNoteQty[i.name] || 0) + i.qty;
    }
  });

  // Items no longer on the active menu cannot be rendered or re-priced, and the
  // server drops them on save. Warn instead of deleting them silently.
  const offMenu = Object.keys(S.editQty).filter(n => !S.menuFlat.some(f => f.name === n));
  if (offMenu.length) {
    showToast('تنبيه: ' + offMenu.join('، ') + ' مش في منيو المطعم الحالي وهيتشال لو حفظت');
  }

  document.getElementById('modalTitle').textContent = `تعديل طلب ${h(name)}`;
  renderModal();
  document.getElementById('editModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('editModal').style.display = 'none';
  document.body.style.overflow = '';
  S.editName = null; S.editQty = {}; S.editNotes = {}; S.editNoteQty = {};
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
      const fi   = S.menuFlat.find(f => f.name === item.name);
      const id   = fi ? fi.id : 0;
      const qty  = S.editQty[item.name] || 0;
      const note = S.editNotes[item.name] || '';
      itemsHtml += `
        <div class="item-wrap">
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
          </div>
          <div class="mgr-note-wrap" id="mnwrap-${id}" style="display:${qty > 0 ? 'block' : 'none'}">
            ${_buildModalNoteChips(id, item.name, note)}
            <input class="note-input mgr-note-input" id="mninput-${id}" data-id="${id}" type="text"
              placeholder="📝 ملاحظة (اختياري)" maxlength="200" value="${h(note)}">
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
  if (next === 0) {
    delete S.editQty[item.name];
    delete S.editNotes[item.name];
    delete S.editNoteQty[item.name];
  } else {
    S.editQty[item.name] = next;
    if (S.editNoteQty[item.name] !== undefined) {
      S.editNoteQty[item.name] = Math.min(S.editNoteQty[item.name], next);
    }
  }
  const el = document.getElementById(`mqn-${id}`);
  el.textContent = next;
  el.classList.toggle('nonzero', next > 0);
  // Show the note field only for items actually in the order; clear it on remove.
  const nwrap = document.getElementById(`mnwrap-${id}`);
  if (nwrap) nwrap.style.display = next > 0 ? 'block' : 'none';
  if (next === 0) { const ni = document.getElementById(`mninput-${id}`); if (ni) ni.value = ''; }
  const items = S.menu[item.category] || [];
  const count = items.filter(i => (S.editQty[i.name] || 0) > 0).length;
  const badge = document.getElementById(`mbadge-${item.category}`);
  if (badge) { badge.textContent = count; badge.classList.toggle('show', count > 0); }
}

async function saveModal() {
  // Mirrors the split logic in submitOrder so a manager edit cannot silently
  // rewrite "2 with a note, 1 without" into "3 with a note".
  const items = [];
  Object.entries(S.editQty)
    .filter(([, q]) => q > 0)
    .forEach(([name, qty]) => {
      const note    = (S.editNotes || {})[name];
      const noteQty = note ? Math.min((S.editNoteQty || {})[name] ?? qty, qty) : 0;
      const price   = findPrice(name);
      if (note && noteQty > 0 && noteQty < qty) {
        items.push({ name, qty: noteQty,       price, note });
        items.push({ name, qty: qty - noteQty, price });
      } else {
        const obj = { name, qty, price };
        if (note && noteQty > 0) obj.note = note;
        items.push(obj);
      }
    });
  if (!items.length) {
    showConfirm(`هتمسح طلب ${S.editName} بالكامل؟`, () => _doSaveModal(items));
    return;
  }
  await _doSaveModal(items);
}

async function _doSaveModal(items) {
  const saveBtn = document.getElementById('modalSaveBtn');
  setBtnLoading(saveBtn, 'جاري الحفظ');
  try {
    const res = await api('mgr_update', { data: { name: S.editName, items }, ref: S.mgrKey });
    const idx = S.orders.findIndex(o => o.name === S.editName);
    if (items.length === 0) {
      if (idx !== -1) S.orders.splice(idx, 1);
    } else {
      // Same rule as the user path: trust the server's version, not ours. The
      // response carries `paid` so payment status is not lost on edit.
      const canonical = (res && res.order)
        ? res.order
        : { name: S.editName, items, paid: idx !== -1 ? S.orders[idx].paid : false };
      if (idx !== -1) S.orders[idx] = canonical;
      else S.orders.push(canonical);
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

// ── Manager auth / actions ───────────────────────────────────────
async function doManagerLogin() {
  const code = document.getElementById('mgrCodeInput').value.trim();
  if (!code) { showToast('ادخل الكود'); return; }
  const btn = document.querySelector('#screen-mgr-login .btn');
  setBtnLoading(btn, 'جاري التحقق');
  try {
    const res = await api('verify', { ref: code });
    if (!res.success) { showToast('بس يا بابا. بلاش لعب'); resetBtn(btn); return; }
    S.mgrKey = code;
    stopUserPoll();
    await refreshManagerDashboard();
    showScreen('screen-manager');
    S.mgrRefreshTimer = setInterval(refreshManagerDashboard, 10000);
  } catch (e) {
    showToast('خطأ في الاتصال ❌'); resetBtn(btn);
  }
}

function exitManager() {
  if (S.mgrRefreshTimer) { clearInterval(S.mgrRefreshTimer); S.mgrRefreshTimer = null; }
  S.mgrKey     = null;
  S.namesAdmin = [];
  // Re-fetch via the PUBLIC endpoint so the in-memory copy stops carrying
  // payment status once we are back on user screens.
  api('getOrders').then(fresh => { if (fresh && fresh.data) S.orders = fresh.data; }).catch(() => {});
  api('getStatus').then(r => {
    S.isLocked     = r.locked;
    S.lockTime     = r.lockTime;
    S.orderingOpen = r.orderingOpen === true;
    if (r.paymentInfo) S.paymentInfo = r.paymentInfo;
    if (typeof r.deliveryFee === 'number') S.deliveryFee = r.deliveryFee;
    if (S.isLocked) renderClosedScreen(null);
    else if (!S.orderingOpen) { startUserPoll(); renderNotOpenScreen(); }
    else { startUserPoll(); renderNameScreen(); }
  }).catch(() => { startUserPoll(); renderNameScreen(); });
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
      S.paymentInfo  = { collectorName: '', paymentCash: false, paymentInstapay: false, instapayNumber: '' };
      showToast('تم التصفير ✓');
      renderManagerDashboard();
    } catch (e) { showToast(e.message || 'فشل التصفير ❌'); }
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

// Copies the restaurant order, but only after re-reading it from the database,
// so a stale in-memory copy can never reach the kitchen.
async function copyRestaurantText() {
  try {
    const fresh = await api('getOrdersAdmin', { ref: S.mgrKey });
    if (fresh && fresh.data) S.orders = fresh.data;
  } catch (e) {
    showToast('مش قادر أحدّث الطلبات — جرب تاني');
    return;
  }
  renderManagerDashboard();
  try {
    await navigator.clipboard.writeText(buildRestaurantText());
    showToast('تم النسخ ✓');
  } catch (e) {
    showToast('فشل النسخ');
  }
}
