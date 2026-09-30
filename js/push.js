// js/push.js — Web Push: register this device so it gets the "food arrived" alert.
// Fully no-op when the browser can't do push or the server has no VAPID key.

function pushSupported() {
  return 'serviceWorker' in navigator &&
         'PushManager'   in window &&
         'Notification'  in window;
}

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getExistingPushSub() {
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (e) { return null; }
}

// Tied to the "🔔 نبّهني" button on the submitted screen (a real user gesture,
// which the permission prompt requires).
async function enablePush(name) {
  if (!pushSupported())   { showToast('جهازك مش بيدعم الإشعارات'); return; }
  if (!S.vapidPublicKey)  { showToast('الإشعارات مش متاحة دلوقتي'); return; }

  let perm = Notification.permission;
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (e) {}
  }
  if (perm !== 'granted') {
    showToast(perm === 'denied' ? 'الإشعارات مقفولة من إعدادات المتصفح' : 'محتاج إذن الإشعارات');
    renderPushPrompt();
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlB64ToUint8Array(S.vapidPublicKey)
      });
    }
    const who = name || S.currentName || '';
    await api('savePushSubscription', { subscription: sub.toJSON(), name: who });
    S._pushSubName = who;
    showToast('تمام! هيوصلك إشعار لما الأكل يجي 🍽️');
  } catch (e) {
    showToast('مش قادر أفعّل الإشعارات، جرب تاني');
  }
  renderPushPrompt();
}

// Fills #pushPrompt on the submitted screen based on the current push state.
async function renderPushPrompt() {
  const el = document.getElementById('pushPrompt');
  if (!el) return;

  if (!pushSupported() || !S.vapidPublicKey) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const perm = Notification.permission;
  const sub  = await getExistingPushSub();
  el.style.display = 'block';

  if (perm === 'granted' && sub) {
    // Keep the stored name in step with whoever is on this device now — but only
    // when it actually changed, so re-renders don't spam the server.
    if (S.currentName && S.currentName !== S._pushSubName) {
      S._pushSubName = S.currentName;
      api('savePushSubscription', { subscription: sub.toJSON(), name: S.currentName }).catch(() => {});
    }
    el.innerHTML = '<div class="push-on">🔔 الإشعارات مفعّلة — هننبّهك لما الأكل يوصل</div>';
  } else if (perm === 'denied') {
    el.innerHTML = '<div class="push-off">🔕 الإشعارات مقفولة من إعدادات المتصفح</div>';
  } else {
    el.innerHTML = '<button class="btn btn-outline push-btn" data-action="enablePush">🔔 نبّهني لما الأكل يوصل</button>';
  }
}
