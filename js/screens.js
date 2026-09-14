// ================================================================
// SCREEN RENDERERS
// ================================================================

/* ---------- NAME SCREEN ---------- */
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
  document.getElementById('nameSelect').value = '';

  // "النهاردة هنطلب من ..." so people know which restaurant they're ordering from.
  const _rb = document.getElementById('todayRestaurantBanner');
  if (_rb) {
    const rest = (S.restaurants || []).find(r => r.id === S.activeRestaurantId);
    if (rest && rest.name) {
      _rb.textContent = '🍽️ النهاردة هنطلب من ' + rest.name;
      _rb.style.display = 'block';
    } else {
      _rb.style.display = 'none';
    }
  }

  const previewEl = document.getElementById('lastOrderPreview');
  if (previewEl) previewEl.style.display = 'none';

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
      _b.textContent  = '📝 بتطلب لشخص تاني — أنت: ' + S.orderedBy;
      _b.style.display = 'block';
    } else {
      _b.style.display = 'none';
    }
  }
  showScreen('screen-name');
}


// Notes other people already used on this exact item, so users tap an existing
// phrasing instead of inventing a new one ("كاتشب بس" vs "بكاتشب بس").
// Prevention, not merging: there is deliberately no fuzzy matching anywhere.
function _buildNoteChips(id, itemName, existingNote) {
  const list = (S.noteSuggestions && S.noteSuggestions[itemName]) || [];
  if (!list.length) return '';
  const chips = list.slice(0, 8).map(note => {
    const sel = (note === existingNote) ? ' selected' : '';
    return `<button class="note-chip${sel}" data-action="pickNote" data-id="${id}" data-note="${h(note)}">${h(note)}</button>`;
  }).join('');
  return `<div class="note-chips" id="nchips-${id}">${chips}</div>`;
}

// Update the order screen's note chips IN PLACE when new suggestions arrive from
// the poll, so a phrasing someone else just used ("كاتشب بس") appears for the
// next person without a full re-render (which would wipe their in-progress
// quantities and typed text). Only the chip container is touched; the note
// input, its value, and its focus are never disturbed.
function refreshNoteChips() {
  if (!Array.isArray(S.menuFlat)) return;
  S.menuFlat.forEach(fi => {
    const id   = fi.id;
    const wrap = document.getElementById(`nwrap-${id}`);
    if (!wrap) return;                                   // item not on screen
    const want     = ((S.noteSuggestions && S.noteSuggestions[fi.name]) || []).slice(0, 8);
    const existing = document.getElementById(`nchips-${id}`);
    if (existing) {
      // Skip items whose suggestion set is unchanged, so chips the user is
      // interacting with are never needlessly torn down and rebuilt.
      const have = [...existing.querySelectorAll('.note-chip')].map(c => c.dataset.note);
      if (have.length === want.length && have.every((n, i) => n === want[i])) return;
    } else if (!want.length) {
      return;
    }
    const input   = document.getElementById(`ninput-${id}`);
    const current  = input ? input.value : (S.currentNotes[fi.name] || '');
    const html     = _buildNoteChips(id, fi.name, current);   // '' when no suggestions
    if (existing) { html ? (existing.outerHTML = html) : existing.remove(); }
    else if (html) { wrap.insertAdjacentHTML('afterbegin', html); }
  });
}

// Same chips for the manager's edit modal. Distinct ids/action so they never
// collide with the order screen's chips, which may still exist in a hidden
// screen in the same session.
function _buildModalNoteChips(id, itemName, existingNote) {
  const list = (S.noteSuggestions && S.noteSuggestions[itemName]) || [];
  if (!list.length) return '';
  const chips = list.slice(0, 8).map(note => {
    const sel = (note === existingNote) ? ' selected' : '';
    return `<button class="note-chip${sel}" data-action="mgrPickNote" data-id="${id}" data-note="${h(note)}">${h(note)}</button>`;
  }).join('');
  return `<div class="note-chips" id="mnchips-${id}">${chips}</div>`;
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
      const flatItem        = S.menuFlat.find(f => f.name === item.name);
      const id              = flatItem ? flatItem.id : 0;
      const qty             = S.currentQty[item.name] || 0;
      const existingNote    = S.currentNotes[item.name] || '';
      const existingNoteQty = S.currentNoteQty[item.name] ?? qty;
      const showNoteQtyRow  = !!(existingNote && qty > 1);
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
          <button class="note-btn${existingNote ? ' has-note' : ''}" id="nbtn-${id}"
            data-action="toggleNote" data-id="${id}"${qty > 0 ? '' : ' style="display:none"'}>📝 ملاحظة</button>
          <div class="note-input-wrap" id="nwrap-${id}"${existingNote ? ' style="display:block"' : ''}>
            ${_buildNoteChips(id, item.name, existingNote)}
            <input class="note-input" id="ninput-${id}" data-id="${id}" type="text"
              placeholder="مثلاً: بدون طماطم" maxlength="200" value="${h(existingNote)}">
            <div class="note-qty-row" id="nqrow-${id}" style="${showNoteQtyRow ? 'display:flex' : 'display:none'}">
              <span class="note-qty-label">يطبق على</span>
              <div class="note-qty-ctrl">
                <button class="note-qty-btn" data-action="noteQtyAdj" data-id="${id}" data-delta="-1">−</button>
                <span class="note-qty-num" id="nqnum-${id}">${existingNoteQty}</span>
                <button class="note-qty-btn" data-action="noteQtyAdj" data-id="${id}" data-delta="+1">+</button>
              </div>
              <span class="note-qty-of" id="nqof-${id}">من ${qty}</span>
            </div>
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
  if (badge) { badge.textContent = count; badge.classList.toggle('show', count > 0); }
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

  const submitTime = loadSubmitTime(S.currentName);
  const subLabel = document.getElementById('subLabel');
  subLabel.textContent = submitTime ? 'تم حفظ طلبك — ' + submitTime : 'تم حفظ طلبك بنجاح!';

  const order     = S.orders.find(o => normAr(o.name) === normAr(S.currentName));
  const items     = order ? order.items : [];
  const foodTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const people    = Math.max(
    S._serverOrdersCount !== null ? S._serverOrdersCount : S.orders.length,
    S.orders.length,
    1
  );
  const delShare = S.deliveryFee / people;
  const grand    = roundPersonTotal(foodTotal + delShare);
  const displayedDel = grand - foodTotal;   // absorbs rounding so food + del = total

  document.getElementById('subList').innerHTML = items.map(i =>
    '<div class="sub-item"><span><span class="qty-tag">×' + i.qty + '</span>' + h(i.name) +
    (i.note ? ' <span class="sub-note">📝 ' + h(i.note) + '</span>' : '') +
    '</span><span>' + (i.price * i.qty) + ' ج</span></div>'
  ).join('');

  var delWarn = people <= 1
    ? '<div class="sub-del-warn">⚠️ لسه محدش طلب غيرك — التوصيل هيقل لما يزودوا</div>'
    : '';

  var delRow = S.deliveryFee > 0
    ? '<div class="sub-trow"><span>توصيل (' + people + ' أشخاص)</span><span>' + fmtNum(displayedDel) + ' ج</span></div>' + delWarn
    : '';

  document.getElementById('subTotalBox').innerHTML =
    '<div class="sub-totals">' +
    '<div class="sub-trow"><span>طعام</span><span>' + foodTotal + ' ج</span></div>' +
    delRow +
    '<div class="sub-trow sub-grand"><span>حسابك</span><span>' + grand + ' جنيه</span></div>' +
    '</div>';

  var piBox = document.getElementById('subPaymentBox');
  if (piBox) piBox.innerHTML = S.isLocked ? _buildPaymentBox() : '';

  showScreen('screen-submitted');
}

function _buildPaymentBox() {
  const pi = S.paymentInfo;
  if (!pi || !pi.collectorName) return '';
  if (!pi.paymentCash && !pi.paymentInstapay) return '';

  const cards = [];

  
  if (pi.paymentInstapay && pi.instapayNumber) {
    const isLink = /^https?:\/\//i.test(pi.instapayNumber.trim());
    const ipLogo = '<img class="pi-ip-logo" alt="" src="./icons/instapay.png">';
    if (isLink) {
      cards.push(`<a href="${h(pi.instapayNumber.trim())}" target="_blank" rel="noopener" class="pi-card pi-card-instapay">
        ${ipLogo}
        <div class="pi-card-label">InstaPay</div>
        <div class="pi-card-detail">اضغط هيفتح التطبيق</div>
      </a>`);
    } else {
      cards.push(`<div class="pi-card pi-card-instapay">
        ${ipLogo}
        <div class="pi-card-label">InstaPay</div>
        <div class="pi-card-detail" dir="ltr">${h(pi.instapayNumber)}</div>
      </div>`);
    }
  }

if (pi.paymentCash) {
    cards.push(`<div class="pi-card pi-card-cash" data-action="cashTap">
      <div class="pi-card-label">💵 كاش</div>
      <div class="pi-card-detail">ادفع ل ${h(pi.collectorName)}</div>
    </div>`);
  }

  const gridClass = cards.length === 1 ? 'pi-grid-single' : 'pi-grid-dual';

  return `
    <div class="payment-info-box">
      <div class="pi-title">💳 ادفع لـ <strong>${h(pi.collectorName)}</strong></div>
      <div class="pi-grid ${gridClass}">${cards.join('')}</div>
    </div>`;
}

/* ---------- CLOSED SCREEN ---------- */
function renderClosedScreen(selectedName) {
  document.getElementById('closedTime').textContent =
    S.lockTime ? `تم الإرسال الساعة ${S.lockTime}` : 'تم الإرسال للمطعم';

  fillNameDropdown('closedNameSelect', true);

  if (selectedName) {
    const order = S.orders.find(o => o.name === selectedName);
    if (order) { renderClosedOrder(selectedName, order.items); return; }
  }

  document.getElementById('closedHasOrder').style.display = 'none';
  document.getElementById('closedNoOrder').style.display  = 'block';
  showScreen('screen-closed');
}

function renderClosedOrder(name, items) {
  const people    = S.orders.length || 1;
  // Bug 9.5: use this person's exact share (by order position) so the closed
  // screen matches what the manager expects to collect, to the piaster.
  const idx       = S.orders.findIndex(o => o.name === name);
  const delShare  = deliverySplit(S.deliveryFee, people)[idx >= 0 ? idx : 0];
  const foodTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const grand     = roundPersonTotal(foodTotal + delShare);
  const displayedDel = grand - foodTotal;

  document.getElementById('closedList').innerHTML = items.map(i => `
    <div class="summary-row">
      <span>
        <span class="qty-tag">×${i.qty}</span>${h(i.name)}
        ${i.note ? `<span class="summary-note">📝 ${h(i.note)}</span>` : ''}
      </span>
      <span>${i.price * i.qty} جنيه</span>
    </div>`).join('');

  document.getElementById('closedTotalBox').innerHTML = `
    <div class="total-box">
      <div class="trow"><span>إجمالي الطعام</span><span>${foodTotal} جنيه</span></div>
      <div class="trow"><span>التوصيل (${people} أشخاص)</span><span>${fmtNum(displayedDel)} جنيه</span></div>
      <div class="trow grand"><span>حسابك</span><span>${grand} جنيه</span></div>
    </div>`;

  // Payment usually happens AFTER locking, so the closed screen is exactly
  // where users need the collector and InstaPay number.
  const cpBox = document.getElementById('closedPaymentBox');
  if (cpBox) cpBox.innerHTML = _buildPaymentBox();

  document.getElementById('closedHasOrder').style.display = 'block';
  document.getElementById('closedNoOrder').style.display  = 'none';
  showScreen('screen-closed');
}

/* ---------- MANAGER LOGIN ---------- */
function renderManagerLogin() {
  document.getElementById('mgrCodeInput').value = '';
  resetBtn(document.querySelector('#screen-mgr-login .btn'));
  showScreen('screen-mgr-login');
}

/* ---------- NOT OPEN SCREEN ---------- */
function renderNotOpenScreen() { showScreen('screen-not-open'); }

/* ---------- ERROR / RETRY ---------- */
function renderErrorScreen() { showScreen('screen-error'); }
