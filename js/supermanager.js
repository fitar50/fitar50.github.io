// ================================================================
// SUPER MANAGER — restaurants and menu editor
// ================================================================

// Tracks which category blocks are open so re-renders preserve the state.
// Key format: "restId::catName"
const _smOpenCats = new Set();

// Called from app.js after the smToggleCat class toggle so we track new state.
// Reads the category from data attributes, NOT by parsing the element id:
// ids are index-based because a category name may contain spaces (see below).
function smTrackCatToggle(block) {
  const restId = block.dataset.restId;
  const cat    = block.dataset.cat;
  if (!restId || cat === undefined) return;
  const key = `${restId}::${cat}`;
  if (block.classList.contains('open')) _smOpenCats.add(key);
  else _smOpenCats.delete(key);
}

/* ---------- LOGIN ---------- */
function renderSuperMgrLogin() {
  if (S.mgrRefreshTimer) { clearInterval(S.mgrRefreshTimer); S.mgrRefreshTimer = null; }
  stopUserPoll();
  const inp = document.getElementById('superMgrCodeInput');
  if (inp) inp.value = '';
  const btn = document.querySelector('#screen-supermgr-login .btn');
  if (btn) resetBtn(btn);
  showScreen('screen-supermgr-login');
}

async function doSuperMgrLogin() {
  const code = document.getElementById('superMgrCodeInput').value.trim();
  if (!code) { showToast('ادخل الكود'); return; }
  const btn = document.querySelector('#screen-supermgr-login .btn');
  setBtnLoading(btn, 'جاري التحقق');
  try {
    const res = await api('verifySuperMgr', { ref: code });
    if (!res.success) { showToast('كود غلط'); resetBtn(btn); return; }
    S.superKey = code;
    await loadSuperMgrData();
    showScreen('screen-supermgr');
    renderSuperMgrDashboard();
  } catch (e) {
    showToast('خطأ في الاتصال ❌'); resetBtn(btn);
  }
}

function exitSuperMgr() {
  S.superKey  = null;
  S.superData = [];
  _smOpenCats.clear();
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

/* ---------- DATA ---------- */
async function loadSuperMgrData() {
  const r = await api('getMenuAdmin', { ref: S.superKey });
  S.superData = (r.data || []).map(rest => ({
    ...rest,
    _pendingCats: (S.superData.find(d => d.id === rest.id) || {})._pendingCats || []
  }));
  S.restaurants = S.superData.map(r => ({ id: r.id, name: r.name, delivery_fee: r.delivery_fee }));
}

/* ---------- DASHBOARD ---------- */
function renderSuperMgrDashboard() {
  const content = document.getElementById('superMgrContent');
  if (!content) return;

  const restListHtml = S.superData.length
    ? S.superData.map(rest => {
        const isActive = rest.id === S.activeRestaurantId;
        return `
          <div class="sm-rest-item" id="smrest-${rest.id}">
            <div class="sm-rest-row">
              <span class="sm-rest-name">${h(rest.name)}</span>
              ${isActive ? '<span class="sm-active-badge">نشط اليوم</span>' : ''}
              <button class="sm-icon-btn" data-action="smRenameRestaurant" data-id="${rest.id}" title="تعديل">✏️</button>
              <button class="sm-icon-btn sm-icon-del" data-action="smDeleteRestaurant" data-id="${rest.id}" title="مسح">🗑️</button>
            </div>
            <div class="sm-rename-row" id="smrename-${rest.id}">
              <input type="text" id="smrename-inp-${rest.id}" value="${h(rest.name)}" maxlength="60">
              <button class="sm-add-btn" style="font-size:13px;height:36px;padding:0 12px;"
                data-action="smSaveRenameRestaurant" data-id="${rest.id}">حفظ</button>
              <button class="sm-icon-btn" data-action="smCancelRename">✕</button>
            </div>
          </div>`;
      }).join('')
    : '<p style="color:var(--grey);text-align:center;font-size:13px;padding:12px;">مفيش مطاعم — أضف واحد ↑</p>';

  const menuHtml = S.superData.map(rest => {
    const cats = {};
    (rest.items || []).forEach(item => {
      if (!cats[item.category]) cats[item.category] = [];
      cats[item.category].push(item);
    });
    (rest._pendingCats || []).forEach(cat => { if (!cats[cat]) cats[cat] = []; });

    // Note suggestions grouped by item name for this restaurant
    const notesByItem = {};
    (rest.noteSuggestions || []).forEach(n => {
      if (!notesByItem[n.item_name]) notesByItem[n.item_name] = [];
      notesByItem[n.item_name].push(n);
    });

    const catNames = Object.keys(cats);

    const catBlocks = catNames.length
      ? catNames.map((cat, ci) => {
          // CRITICAL: DOM ids are built from a numeric index, never from the
          // category name. An HTML id cannot contain a space, so a category
          // like "مشروبات ساخنة" would make every getElementById here return
          // null and silently break add-item / rename / toggle.
          // The real name travels in data-cat only.
          const uid       = `${rest.id}-${ci}`;
          const items     = cats[cat];
          const isOpen    = _smOpenCats.has(`${rest.id}::${cat}`);
          const isPending = items.length === 0;

          const itemRows = items.map(item => {
            const notes = notesByItem[item.name] || [];
            const noteHtml = notes.length
              ? `<div class="sm-note-list">${notes.map(n =>
                  `<span class="sm-note-pill">${h(n.note)}<button class="sm-note-del" data-action="smDeleteNote" data-id="${n.id}" title="مسح الملاحظة">✕</button></span>`
                ).join('')}</div>`
              : '';
            return `
            <div class="sm-item-row" id="smitem-row-${item.id}">
              <span class="sm-item-name">${h(item.name)}</span>
              <span class="sm-item-price">${item.price} ج</span>
              <button class="sm-icon-btn" data-action="smToggleItem" data-id="${item.id}" title="تعديل">✏️</button>
              <button class="sm-icon-btn sm-icon-del" data-action="smDeleteItem" data-id="${item.id}" title="مسح">🗑️</button>
            </div>
            ${noteHtml}
            <div class="sm-edit-row" id="smitem-edit-${item.id}">
              <input class="sm-edit-name" type="text" value="${h(item.name)}" maxlength="80" id="smitem-name-${item.id}" placeholder="الاسم">
              <input class="sm-edit-price" type="number" value="${item.price}" min="1" id="smitem-price-${item.id}" placeholder="السعر">
              <button class="sm-add-btn" style="font-size:12px;height:36px;padding:0 10px;"
                data-action="smSaveItem" data-id="${item.id}">حفظ</button>
            </div>`;
          }).join('');

          return `
            <div class="sm-cat-block${isOpen ? ' open' : ''}" id="smcat-${uid}"
                 data-rest-id="${rest.id}" data-cat="${h(cat)}">
              <div class="sm-cat-header" data-action="smToggleCat">
                <span class="sm-cat-name">${h(cat)}${isPending ? ' <span style="font-size:11px;color:#f77f00;">(جديد)</span>' : ''}</span>
                ${isPending ? '' : `
                  <button class="sm-icon-btn" style="font-size:13px;"
                    data-action="smRenameCategory" data-uid="${uid}" data-rest-id="${rest.id}" data-cat="${h(cat)}" title="تعديل اسم الفئة">✏️</button>
                  <button class="sm-icon-btn sm-icon-del" style="font-size:13px;"
                    data-action="smDeleteCategory" data-rest-id="${rest.id}" data-cat="${h(cat)}" title="مسح الفئة">🗑️</button>`}
                <span class="sm-cat-chevron">▼</span>
              </div>
              ${isPending ? '' : `
                <div class="sm-cat-rename-row" id="smcatrename-${uid}">
                  <input type="text" value="${h(cat)}" maxlength="40" id="smcatrename-inp-${uid}">
                  <button class="sm-add-btn" style="font-size:12px;height:34px;padding:0 10px;"
                    data-action="smSaveRenameCategory" data-uid="${uid}" data-rest-id="${rest.id}" data-cat="${h(cat)}">حفظ</button>
                  <button class="sm-icon-btn" data-action="smCancelRename">✕</button>
                </div>`}
              <div class="sm-cat-body">
                ${itemRows}
                <div class="sm-add-item-row">
                  <input class="sm-add-item-name" type="text" placeholder="اسم صنف جديد" maxlength="80" id="smadditm-name-${uid}">
                  <input class="sm-add-item-price" type="number" placeholder="السعر" min="1" id="smadditm-price-${uid}">
                  <button class="sm-add-btn" style="font-size:12px;height:36px;padding:0 10px;"
                    data-action="smAddItem" data-uid="${uid}" data-rest-id="${rest.id}" data-cat="${h(cat)}">+ إضافة</button>
                </div>
              </div>
            </div>`;
        }).join('')
      : '<p style="color:var(--grey);font-size:13px;padding:10px 14px;">مفيش أصناف — أضف فئة وأصناف ↓</p>';

    return `
      <div class="sm-rest-block">
        <div class="sm-rest-header">
          <span>🏪 ${h(rest.name)}</span>
          <span class="sm-fee-wrap">
            <input class="sm-fee-input" type="number" min="0" id="smfee-${rest.id}" value="${rest.delivery_fee}">
            <span class="sm-fee-lbl">ج توصيل</span>
            <button class="sm-add-btn" style="font-size:12px;height:32px;padding:0 10px;"
              data-action="smSaveFee" data-id="${rest.id}">حفظ</button>
          </span>
        </div>
        <div class="sm-fee-hint">ده الافتراضي — المدير يقدر يعدله لليوم من لوحة المدير</div>
        ${catBlocks}
        <div class="sm-add-cat-row">
          <input type="text" placeholder="فئة جديدة (مثلاً: مشروبات ساخنة)" maxlength="40" id="smaddcat-${rest.id}">
          <button class="sm-add-btn" style="font-size:13px;" data-action="smAddCategory" data-rest-id="${rest.id}">+ فئة</button>
        </div>
      </div>`;
  }).join('') || '<p style="color:var(--grey);text-align:center;font-size:13px;padding:12px;">أضف مطعم أولاً ↑</p>';

  content.innerHTML = `
    <div class="section-title">المطاعم</div>
    <div class="sm-section">
      <div class="sm-add-row">
        <input type="text" id="smNewRestName" placeholder="اسم مطعم جديد" maxlength="60">
        <button class="sm-add-btn" data-action="smAddRestaurant">+ إضافة</button>
      </div>
      ${restListHtml}
    </div>
    <div class="section-title" style="margin-top:8px;">قوائم الأكل</div>
    <div class="sm-note-hint">مسح الملاحظة بيشيلها من الاقتراحات بس — الطلبات القديمة ما بتتغيرش</div>
    <div class="sm-section">
      ${menuHtml}
    </div>`;
}

/* ---------- RESTAURANTS ---------- */
async function smAddRestaurant() {
  const inp  = document.getElementById('smNewRestName');
  const name = inp ? inp.value.trim() : '';
  if (!name) { showToast('ادخل اسم المطعم'); return; }
  if (S.superData.some(r => normAr(r.name) === normAr(name))) { showToast('المطعم ده موجود'); return; }
  const btn = document.querySelector('[data-action="smAddRestaurant"]');
  if (btn) setBtnLoading(btn, '...');
  try {
    const res = await api('addRestaurant', { name, ref: S.superKey });
    if (inp) inp.value = '';
    S.superData.push({ id: res.id, name: res.name, items: [], _pendingCats: [] });
    S.restaurants = S.superData.map(r => ({ id: r.id, name: r.name }));
    showToast('تم إضافة المطعم ✓');
    renderSuperMgrDashboard();
  } catch (e) { showToast(e.message || 'فشل ❌');
  } finally { if (btn) resetBtn(btn); }
}

function smStartRenameRestaurant(id) {
  const row = document.getElementById(`smrename-${id}`);
  if (row) { row.style.display = 'flex'; document.getElementById(`smrename-inp-${id}`)?.focus(); }
}

async function smSaveRenameRestaurant(id) {
  const inp  = document.getElementById(`smrename-inp-${id}`);
  const name = inp ? inp.value.trim() : '';
  if (!name) { showToast('الاسم فاضي'); return; }
  try {
    await api('renameRestaurant', { id, name, ref: S.superKey });
    const rest = S.superData.find(r => r.id === id);
    if (rest) rest.name = name;
    S.restaurants = S.superData.map(r => ({ id: r.id, name: r.name }));
    showToast('تم التعديل ✓');
    renderSuperMgrDashboard();
  } catch (e) { showToast(e.message || 'فشل ❌'); }
}

function smCancelRename(el) {
  // The two rename rows hide differently and must not be mixed up:
  //   .sm-cat-rename-row  is shown/hidden by the `show` CLASS
  //   .sm-rename-row      is shown/hidden by an INLINE style
  // Setting an inline display:none on the class-driven one would outrank the
  // .show rule forever, so that row could never be reopened.
  const catRow = el.closest('.sm-cat-rename-row');
  if (catRow) {
    catRow.classList.remove('show');
    catRow.style.display = '';   // clear any stale inline value
    return;
  }
  const restRow = el.closest('.sm-rename-row');
  if (restRow) restRow.style.display = 'none';
}

async function smDeleteRestaurant(id) {
  const rest = S.superData.find(r => r.id === id);
  if (!rest) return;
  showConfirm(`هتمسح "${rest.name}" وكل أصنافه نهائياً؟`, async () => {
    try {
      await api('deleteRestaurant', { id, ref: S.superKey });
      S.superData   = S.superData.filter(r => r.id !== id);
      S.restaurants = S.superData.map(r => ({ id: r.id, name: r.name }));
      showToast('تم المسح ✓');
      renderSuperMgrDashboard();
    } catch (e) { showToast(e.message || 'فشل ❌'); }
  });
}

/* ---------- CATEGORIES ---------- */
async function smAddCategory(restId) {
  const inp = document.getElementById(`smaddcat-${restId}`);
  const cat = inp ? inp.value.trim() : '';
  if (!cat) { showToast('ادخل اسم الفئة'); return; }
  const rest = S.superData.find(r => r.id === restId);
  if (rest) {
    const exists = rest.items.some(i => i.category === cat) ||
                   (rest._pendingCats || []).includes(cat);
    if (exists) { showToast('الفئة دي موجودة بالفعل'); return; }
    rest._pendingCats = rest._pendingCats || [];
    rest._pendingCats.push(cat);
  }
  if (inp) inp.value = '';
  // A category only exists in the DB once it has an item, so it stays "pending"
  // in the UI until the first item is added.
  _smOpenCats.add(`${restId}::${cat}`);
  renderSuperMgrDashboard();
  showToast(`فئة "${cat}" — أضف أصناف ↓`);
}

function smStartRenameCategory(uid) {
  const row = document.getElementById(`smcatrename-${uid}`);
  if (row) { row.classList.add('show'); document.getElementById(`smcatrename-inp-${uid}`)?.focus(); }
}

async function smSaveRenameCategory(uid, restId, oldCat) {
  const inp    = document.getElementById(`smcatrename-inp-${uid}`);
  const newCat = inp ? inp.value.trim() : '';
  if (!newCat || newCat === oldCat) { showToast('الاسم مش اتغير'); return; }
  try {
    await api('renameCategory', { restaurantId: restId, oldName: oldCat, newName: newCat, ref: S.superKey });
    const rest = S.superData.find(r => r.id === restId);
    if (rest) rest.items.forEach(i => { if (i.category === oldCat) i.category = newCat; });
    const wasOpen = _smOpenCats.has(`${restId}::${oldCat}`);
    _smOpenCats.delete(`${restId}::${oldCat}`);
    if (wasOpen) _smOpenCats.add(`${restId}::${newCat}`);
    showToast('تم تعديل اسم الفئة ✓');
    renderSuperMgrDashboard();
  } catch (e) { showToast(e.message || 'فشل ❌'); }
}

async function smDeleteCategory(restId, cat) {
  const rest  = S.superData.find(r => r.id === restId);
  const count = rest ? rest.items.filter(i => i.category === cat).length : 0;
  showConfirm(`هتمسح فئة "${cat}" (${count} صنف) نهائياً؟`, async () => {
    try {
      await api('deleteCategory', { restaurantId: restId, category: cat, ref: S.superKey });
      if (rest) rest.items = rest.items.filter(i => i.category !== cat);
      _smOpenCats.delete(`${restId}::${cat}`);
      await loadSuperMgrData();
      showToast('تم مسح الفئة ✓');
      renderSuperMgrDashboard();
    } catch (e) { showToast(e.message || 'فشل ❌'); }
  });
}

/* ---------- ITEMS ---------- */
async function smAddItem(uid, restId, cat) {
  const nameInp  = document.getElementById(`smadditm-name-${uid}`);
  const priceInp = document.getElementById(`smadditm-price-${uid}`);
  const name     = nameInp  ? nameInp.value.trim()     : '';
  const price    = priceInp ? parseInt(priceInp.value) : 0;
  if (!name)        { showToast('ادخل اسم الصنف'); return; }
  if (!(price > 0)) { showToast('ادخل سعر صحيح');  return; }

  const btn = document.querySelector(`[data-action="smAddItem"][data-uid="${uid}"]`);
  if (btn) setBtnLoading(btn, '...');
  try {
    const res  = await api('addMenuItem', { restaurantId: restId, category: cat, name, price, ref: S.superKey });
    const rest = S.superData.find(r => r.id === restId);
    if (rest) {
      rest.items.push({ id: res.id, restaurant_id: restId, category: cat, name, price, sort_order: 999 });
      rest._pendingCats = (rest._pendingCats || []).filter(c => c !== cat);
    }
    if (nameInp)  nameInp.value  = '';
    if (priceInp) priceInp.value = '';
    _smOpenCats.add(`${restId}::${cat}`);
    showToast('تم إضافة الصنف ✓');
    renderSuperMgrDashboard();
  } catch (e) { showToast(e.message || 'فشل ❌');
  } finally { if (btn) resetBtn(btn); }
}

function smToggleEditItem(id) {
  const editRow = document.getElementById(`smitem-edit-${id}`);
  if (!editRow) return;
  const nowShowing = editRow.classList.toggle('show');
  if (nowShowing) document.getElementById(`smitem-name-${id}`)?.focus();
}

async function smSaveItem(id) {
  const name  = document.getElementById(`smitem-name-${id}`)?.value.trim();
  const price = parseInt(document.getElementById(`smitem-price-${id}`)?.value);
  if (!name)        { showToast('الاسم فاضي');   return; }
  if (!(price > 0)) { showToast('سعر غلط');      return; }

  let cat = '', restId = null;
  for (const rest of S.superData) {
    const item = rest.items.find(i => i.id === id);
    if (item) { cat = item.category; restId = rest.id; break; }
  }

  const btn = document.querySelector(`[data-action="smSaveItem"][data-id="${id}"]`);
  if (btn) setBtnLoading(btn, '...');
  try {
    await api('editMenuItem', { id, name, price, category: cat, ref: S.superKey });
    for (const rest of S.superData) {
      const item = rest.items.find(i => i.id === id);
      if (item) { item.name = name; item.price = price; break; }
    }
    if (restId && cat) _smOpenCats.add(`${restId}::${cat}`);
    await loadSuperMgrData();
    showToast('تم التعديل ✓');
    renderSuperMgrDashboard();
  } catch (e) { showToast(e.message || 'فشل ❌');
  } finally { if (btn) resetBtn(btn); }
}

async function smDeleteItem(id) {
  let itemName = '', restId = null, cat = '';
  for (const rest of S.superData) {
    const item = rest.items.find(i => i.id === id);
    if (item) { itemName = item.name; restId = rest.id; cat = item.category; break; }
  }
  showConfirm(`هتمسح "${itemName}"؟`, async () => {
    try {
      await api('deleteMenuItem', { id, ref: S.superKey });
      const rest = S.superData.find(r => r.id === restId);
      if (rest) rest.items = rest.items.filter(i => i.id !== id);
      if (restId && cat) _smOpenCats.add(`${restId}::${cat}`);
      // Server cascades note_suggestions; reload so the local copy matches.
      await loadSuperMgrData();
      showToast('تم مسح الصنف ✓');
      renderSuperMgrDashboard();
    } catch (e) { showToast(e.message || 'فشل ❌'); }
  });
}

/* ---------- DELIVERY FEE (per restaurant) ---------- */
async function smSaveFee(restId) {
  const raw = document.getElementById(`smfee-${restId}`)?.value.trim() ?? '';
  const fee = parseInt(raw, 10);
  if (raw === '' || !Number.isFinite(fee) || fee < 0 || String(fee) !== raw) {
    showToast('رقم غلط'); return;
  }
  const btn = document.querySelector(`[data-action="smSaveFee"][data-id="${restId}"]`);
  if (btn) setBtnLoading(btn, '...');
  try {
    await api('setRestaurantFee', { id: restId, fee, ref: S.superKey });
    const rest = S.superData.find(r => r.id === restId);
    if (rest) rest.delivery_fee = fee;
    S.restaurants = S.superData.map(r => ({ id: r.id, name: r.name, delivery_fee: r.delivery_fee }));
    showToast('تم حفظ رسوم التوصيل ✓');
    renderSuperMgrDashboard();
  } catch (e) { showToast(e.message || 'فشل ❌');
  } finally { const b = document.querySelector(`[data-action="smSaveFee"][data-id="${restId}"]`); if (b) resetBtn(b); }
}

/* ---------- NOTE SUGGESTIONS ---------- */
// Delete only, deliberately. Editing a suggestion would silently rewrite what
// other users see with no trace; if the text is wrong, delete it and the next
// correct submission recreates it.
async function smDeleteNote(id) {
  let noteText = '', itemName = '';
  for (const rest of S.superData) {
    const n = (rest.noteSuggestions || []).find(x => x.id === id);
    if (n) { noteText = n.note; itemName = n.item_name; break; }
  }
  showConfirm(`هتمسح الملاحظة "${noteText}" من ${itemName}؟`, async () => {
    try {
      await api('deleteNoteSuggestion', { id, ref: S.superKey });
      S.superData.forEach(rest => {
        if (rest.noteSuggestions) rest.noteSuggestions = rest.noteSuggestions.filter(x => x.id !== id);
      });
      showToast('تم مسح الملاحظة ✓');
      renderSuperMgrDashboard();
    } catch (e) { showToast(e.message || 'فشل ❌'); }
  });
}
