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
      S.currentQty = {};
      S.isDirty    = false;
      S.orderedBy  = null;
      if (S.isLocked) renderClosedScreen(S.currentName);
      else             renderNameScreen();
      break;

    case 'screen-mgr-login':
      if (S.isLocked) renderClosedScreen(null);
      else             renderNameScreen();
      break;

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
