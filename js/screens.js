// ================================================================
// SCREEN RENDERERS
// ================================================================

/* ---------- NAME SCREEN ---------- */
// Shows ✓ prefix for names that already have a submitted order today,
// so users can spot at a glance who has ordered.
function fillNameDropdown(selId, skipNew = false) {
  const sel = document.getElementById(selId);
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  S.names.forEach(n => {
    const hasOrder = S.orders.some(o => normAr(o.name) === normAr(n));
    const label    = hasOrder ? `✓ ${n}` : n;
    sel.appendChild(new Option(label, n));
  });
  if (!skipNew) sel.appendChild(new Option('＋ مستخدم جديد', '__new__'));
  if (cur) sel.value = cur;
}

function renderNameScreen() {
  fillNameDropdown('nameSelect', true);
  document.getElementById('editNameBtn').style.display  = 'none';
  document.getElementById('editNameWrap').style.display = 'none';  // Bug #6: reset inline edit
  document.getElementById('nameSelect').value = '';

  // Clear last-order preview when returning to name screen
  const previewEl = document.getElementById('lastOrderPreview');
  if (previewEl) previewEl.style.display = 'none';

  // Bug #12: show "X من Y طلبوا" counter so users see ordering progress at a glance
  const counterEl = document.getElementById('orderCounter');
  if (counterEl) {
    const orderedCount = S.orders.length;
    const totalCount   = S.names.length;
    if (totalCount > 0) {
      const icon = orderedCount === totalCount ? '🎉' : '✅';
      counterEl.textContent = `${icon} طلب ${orderedCount} من ${totalCount}`;
      counterEl.style.display = 'block';
    } else {
      counterEl.style.display = 'none';
    }
  }

  const _b = document.getElementById('orderingForBanner');
  if (_b) {
    if (S.orderedBy) {
      _b.textContent = '📝 بتطلب لشخص تاني — أنت: ' + S.orderedBy;
      _b.style.display = 'block';
    } else {
      _b.style.display = 'none';
    }
  }
  showScreen('screen-name');
}

/* ---------- ORDER SCREEN ---------- */
function renderOrderScreen(name) {
  document.getElementById('orderTitle').textContent = `طلب ${h(name)} 🥙`;
  const container = document.getElementById('menuContainer');
  container.innerHTML = '';

  Object.entries(S.menu).forEach(([cat, items]) => {
    const selectedCount = items.reduce((sum, i) => sum + (S.currentQty[i.name] || 0), 0);
    const block = document.createElement('div');
    block.className = 'category-block' + (selectedCount > 0 ? ' open' : '');
    block.dataset.cat = cat;

    let itemsHtml = '';
    items.forEach(item => {
      const flatItem     = S.menuFlat.find(f => f.name === item.name);
      const id           = flatItem ? flatItem.id : 0;
      const qty          = S.currentQty[item.name] || 0;
      const existingNote = S.currentNotes[item.name] || '';
      // Each item is wrapped in .item-wrap so the note button and input
      // can live below the item row without breaking the border separators.
      // The note button is hidden until qty > 0 (shown by chgQty in app.js).
      // The note input is hidden until the user taps the note button.
      itemsHtml += `
        <div class="item-wrap">
          <div class="item-row">
            <div class="item-info">
              <div class="item-name">${h(item.name)}</div>
              <div class="item-price">${item.price} جنيه</div>
            </div>
            <div class="qty">
              <button class="qty-btn minus" data-action="qty" data-id="${id}" data-delta="-1">−</button>
              <div class="qty-num ${qty > 0 ? 'nonzero' : ''}" id="qn-${id}">${qty}</div>
              <button class="qty-btn plus"  data-action="qty" data-id="${id}" data-delta="+1">+</button>
            </div>
          </div>
          <button class="note-btn${existingNote ? ' has-note' : ''}" id="nbtn-${id}" data-action="toggleNote" data-id="${id}"${qty > 0 ? '' : ' style="display:none"'}>📝 ملاحظة</button>
          <div class="note-input-wrap" id="nwrap-${id}"${existingNote ? ' style="display:block"' : ''}>
            <input class="note-input" id="ninput-${id}" data-id="${id}" type="text"
              placeholder="مثلاً: بدون طماطم" maxlength="200" value="${h(existingNote)}">
          </div>
        </div>`;
    });

    block.innerHTML = `
      <div class="cat-header" data-action="toggleCat">
        <span class="cat-title">${h(cat)}</span>
        <div class="cat-right">
          <span class="cat-badge ${selectedCount ? 'show' : ''}" id="badge-${h(cat)}">${selectedCount}</span>
          <span class="cat-chevron">▼</span>
        </div>
      </div>
      <div class="cat-items">${itemsHtml}</div>`;
    container.appendChild(block);
  });

  updateTotal();
  showScreen('screen-order');
}

function updateCatBadge(cat) {
  const items = S.menu[cat] || [];
  const count = items.reduce((sum, i) => sum + (S.currentQty[i.name] || 0), 0);
  const badge = document.getElementById(`badge-${cat}`);
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }
}

function updateTotal() {
  let total = 0;
  Object.entries(S.currentQty).forEach(([name, qty]) => { total += findPrice(name) * qty; });
  document.getElementById('orderTotal').textContent = `${total} جنيه`;
  document.getElementById('submitBtn').disabled = total === 0;
  const clearBtn = document.getElementById('clearOrderBtn');
  if (clearBtn) clearBtn.style.display = total > 0 ? 'block' : 'none';
}

/* ---------- SUBMITTED SCREEN ---------- */
function renderSubmittedScreen() {
  document.getElementById('subName').textContent = h(S.currentName);

  // Show the time the order was submitted (stored in localStorage with the last-order data)
  const submitTime = loadSubmitTime(S.currentName);
  const subLabel = document.getElementById('subLabel');
  subLabel.textContent = submitTime ? `تم حفظ طلبك — ${submitTime}` : 'تم حفظ طلبك بنجاح!';

  const items = Object.entries(S.currentQty)
    .filter(([, q]) => q > 0)
    .map(([name, qty]) => ({ name, qty, price: findPrice(name) }));
  const foodTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  // Bug #8: use server-side count (kept fresh by poll) when available;
  // S.orders is only fetched once at init so it can lag behind reality
  const people    = Math.max(
    S._serverOrdersCount !== null ? S._serverOrdersCount : S.orders.length,
    S.orders.length,
    1
  );
  const delShare  = DELIVERY_FEE / people;
  const grand     = foodTotal + delShare;

  document.getElementById('subList').innerHTML = items.map(i => `
    <div class="summary-row">
      <span><span class="qty-tag">×${i.qty}</span>${h(i.name)}</span>
      <span>${i.price * i.qty} جنيه</span>
    </div>`).join('');

  const delNote = people <= 1
    ? `<span class="note-alert">⚠️ لسه محدش طلب غيرك — التوصيل هيقل لما يزودوا</span>`
    : `<span class="note">قد يتغير لو اضاف ناس بعدين</span>`;

  document.getElementById('subTotalBox').innerHTML = `
    <div class="total-box">
      <div class="trow"><span>إجمالي الطعام</span><span>${foodTotal} جنيه</span></div>
      <div class="trow">
        <span>التوصيل (${people} أشخاص — تقريبي)<br>${delNote}</span>
        <span>${delShare.toFixed(2)} جنيه</span>
      </div>
      <div class="trow grand"><span>إجماليك المتوقع</span><span>${grand.toFixed(2)} جنيه</span></div>
    </div>`;

  showScreen('screen-submitted');
}

/* ---------- CLOSED SCREEN ---------- */
function renderClosedScreen(selectedName) {
  document.getElementById('closedTime').textContent =
    S.lockTime ? `تم الإرسال الساعة ${S.lockTime}` : 'تم الإرسال للمطعم';

  fillNameDropdown('closedNameSelect', true);

  if (selectedName) {
    const order = S.orders.find(o => o.name === selectedName);
    if (order) {
      renderClosedOrder(selectedName, order.items);
      return;
    }
  }

  document.getElementById('closedHasOrder').style.display = 'none';
  document.getElementById('closedNoOrder').style.display  = 'block';
  showScreen('screen-closed');
}

function renderClosedOrder(name, items) {
  const people    = S.orders.length || 1;
  const delShare  = DELIVERY_FEE / people;
  const foodTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const grand     = foodTotal + delShare;

  document.getElementById('closedList').innerHTML = items.map(i => `
    <div class="summary-row">
      <span><span class="qty-tag">×${i.qty}</span>${h(i.name)}</span>
      <span>${i.price * i.qty} جنيه</span>
    </div>`).join('');

  document.getElementById('closedTotalBox').innerHTML = `
    <div class="total-box">
      <div class="trow"><span>إجمالي الطعام</span><span>${foodTotal} جنيه</span></div>
      <div class="trow"><span>التوصيل (${people} أشخاص)</span><span>${delShare.toFixed(2)} جنيه</span></div>
      <div class="trow grand"><span>إجماليك</span><span>${grand.toFixed(2)} جنيه</span></div>
    </div>`;

  document.getElementById('closedHasOrder').style.display = 'block';
  document.getElementById('closedNoOrder').style.display  = 'none';
  showScreen('screen-closed');
}

/* ---------- MANAGER LOGIN ---------- */
function renderManagerLogin() {
  document.getElementById('mgrCodeInput').value = '';
  showScreen('screen-mgr-login');
}

/* ---------- NOT OPEN SCREEN ---------- */
function renderNotOpenScreen() {
  showScreen('screen-not-open');
}

/* ---------- ERROR / RETRY ---------- */
function renderErrorScreen() {
  showScreen('screen-error');
}
