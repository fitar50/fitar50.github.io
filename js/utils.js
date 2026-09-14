// ================================================================
// UTILITIES
// ================================================================

// HTML escape — prevents XSS when inserting user names / item names
function h(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Arabic normalization (client-side mirror of server normAr)
function normAr(s) {
  return (s || '').replace(/[إأآ]/g, 'ا').trim();
}

// Bug 9.5: split an integer-EGP delivery fee across `people` so the per-person
// shares sum EXACTLY to the fee — no piaster lost to rounding. Works in
// piasters and hands the leftover piasters to the earliest orderers. Returns an
// array of numbers (EGP) of length `people`, aligned to S.orders order so every
// client agrees on who owes the extra piaster. Naive fee/people rounded to 2dp
// leaves the collector short (25/3 -> 8.33×3 = 24.99).
function deliverySplit(fee, people) {
  const n = Math.max(1, parseInt(people, 10) || 1);
  const totalP = Math.round((Number(fee) || 0) * 100); // whole piasters
  const base   = Math.floor(totalP / n);
  let extra    = totalP - base * n;                     // 0..n-1 leftover piasters
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push((base + (extra > 0 ? 1 : 0)) / 100);
    if (extra > 0) extra--;
  }
  return out;
}

// Round a person's total to a clean multiple (see config.js ROUNDING_STEP /
// ROUND_DOWN_SLACK). Rounds up, unless the amount is barely over the lower
// multiple, then down — but never a positive debt down to zero. When
// ROUNDING_STEP is 0 (or missing) the amount is returned unchanged.
function roundPersonTotal(amount) {
  const step = (typeof ROUNDING_STEP === 'number') ? ROUNDING_STEP : 0;
  const slack = (typeof ROUND_DOWN_SLACK === 'number') ? ROUND_DOWN_SLACK : 0;
  const n = Number(amount) || 0;
  if (!(step > 0) || n <= 0) return n;
  const lower = Math.floor(n / step) * step;
  const over  = n - lower;
  if (over === 0) return n;
  if (over <= slack && lower > 0) return lower;   // barely over → down (never to 0)
  return lower + step;                            // otherwise → up
}

// Format a number for display: whole numbers show no decimals (30, not 30.00),
// fractional values show up to 2 decimals (8.33, not 8.330000).
function fmtNum(n) {
  const v = Number(n) || 0;
  return v === Math.floor(v) ? String(v) : v.toFixed(2);
}

// ================================================================
// NAVIGATION / HISTORY
// ================================================================

let _activeScreen = null;
let _handlingPop  = false;

const BASE_SCREENS = new Set(['screen-loading', 'screen-name', 'screen-closed', 'screen-error']);

function showScreen(id) {
  if (id !== 'screen-manager' && S.mgrRefreshTimer) {
    clearInterval(S.mgrRefreshTimer);
    S.mgrRefreshTimer = null;
  }
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const target = document.getElementById(id);
  target.classList.add('active');
  target.style.display = (id === 'screen-loading') ? 'flex' : 'block';
  window.scrollTo(0, 0);

  if (!_handlingPop && id !== 'screen-loading') {
    if (_activeScreen === null) {
      history.replaceState({ screen: id }, '');
    } else if (id !== _activeScreen && !BASE_SCREENS.has(id)) {
      history.pushState({ screen: id }, '');
    } else if (BASE_SCREENS.has(id)) {
      history.replaceState({ screen: id }, '');
    }
  }
  _activeScreen = id;
}

window.addEventListener('popstate', function () {
  _handlingPop = true;
  const from = _activeScreen;

  switch (from) {
    case 'screen-order':
    case 'screen-submitted':
    case 'screen-repeat':
      S.currentQty = {};
      S.isDirty    = false;
      S.orderedBy  = null;
      _clearRememberedUser(); // defined in app.js, available at runtime
      if (S.isLocked) renderClosedScreen(S.currentName);
      else             renderNameScreen();
      break;

    case 'screen-mgr-login': {
      startUserPoll();
      // Respect the remembered user instead of always showing name screen
      var _rem = _loadRememberedUser();
      var _rn = null;
      if (_rem && S.names.some(function(n) { return normAr(n) === normAr(_rem); })) {
        _rn = S.names.find(function(n) { return normAr(n) === normAr(_rem); }) || _rem;
        S.currentName = _rn;
      }
      if (S.isLocked) renderClosedScreen(_rn);
      else if (!S.orderingOpen) renderNotOpenScreen();
      else if (_rn) {
        var _ex = S.orders.find(function(o) { return normAr(o.name) === normAr(_rn); });
        if (_ex) renderSubmittedScreen();
        else     renderOrderScreen(_rn);
      } else renderNameScreen();
      break;
    }

    case 'screen-manager':
      if (S.mgrRefreshTimer) {
        clearInterval(S.mgrRefreshTimer);
        S.mgrRefreshTimer = null;
      }
      S.mgrKey = null;
      renderManagerLogin();
      break;

    default:
      history.back();
      _handlingPop = false;
      return;
  }

  _handlingPop = false;
});

// ================================================================
// TOAST
// ================================================================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ================================================================
// BUTTON LOADING STATE
// ================================================================
function setBtnLoading(btn, text) {
  btn.disabled = true;
  btn.dataset.originalText = btn.innerHTML;
  btn.innerHTML = text + ' <span class="btn-spinner"></span>';
}

function resetBtn(btn) {
  btn.disabled = false;
  btn.innerHTML = btn.dataset.originalText || 'تم';
}

// ================================================================
// SUBMIT TIME — saved per user in localStorage so the submitted
// screen can display when the order was placed.
// ================================================================
function saveSubmitTime(name) {
  try {
    const t = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    localStorage.setItem('fattar_time_' + name, t);
  } catch(e) {}
}

function loadSubmitTime(name) {
  try { return localStorage.getItem('fattar_time_' + name) || null; } catch(e) { return null; }
}

// ================================================================
// CUSTOM CONFIRM SHEET
// Replaces browser confirm() for all DB-hitting operations.
// showConfirm(message, onConfirm) — shows a bottom-sheet modal.
// doConfirm / cancelConfirm — called by the two buttons inside.
// ================================================================
let _confirmCallback = null;

function showConfirm(message, onConfirm) {
  _confirmCallback = onConfirm;
  document.getElementById('confirmMessage').textContent = message;
  const modal = document.getElementById('confirmModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function doConfirm() {
  const modal = document.getElementById('confirmModal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
  const cb = _confirmCallback;
  _confirmCallback = null;
  if (cb) cb();
}

function cancelConfirm() {
  const modal = document.getElementById('confirmModal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
  _confirmCallback = null;
}
