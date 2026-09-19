// js/api.js

async function api(action, params = {}) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(RAILWAY_URL + '/api', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, ...params }),
      signal:  controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (data.success === false && data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('انتهت مهلة الاتصال');
    throw e;
  }
}

async function initLoad() {
  try {
    const r = await api('getAll');

    S.menu              = r.menu              || {};
    S.names             = r.names             || [];
    S.isLocked          = r.locked            === true;
    S.lockTime          = r.lockTime          || '';
    S.orderingOpen      = r.orderingOpen      === true;
    S.orders            = r.orders            || [];
    S.restaurants       = r.restaurants       || [];
    S.activeRestaurantId = r.activeRestaurantId || null;
    S.deliveryFee       = typeof r.deliveryFee === 'number' ? r.deliveryFee : 0;
    S.noteSuggestions   = r.noteSuggestions   || {};
    S.lastOrders        = r.lastOrders        || {};
    S.paymentInfo       = r.paymentInfo       || { collectorName: '', paymentCash: false, paymentInstapay: false, instapayNumber: '' };

    try { sessionStorage.setItem('fattar_menu', JSON.stringify(S.menu)); } catch(e) {}

    buildMenuFlat();
    S._serverOrdersCount = S.orders.length;
    return true;
  } catch (e) {
    return false;
  }
}

function buildMenuFlat() {
  S.menuFlat = [];
  Object.entries(S.menu).forEach(([cat, items]) => {
    items.forEach(item => {
      S.menuFlat.push({ id: S.menuFlat.length, name: item.name, price: item.price, category: cat });
    });
  });
}

async function cancelOrder(name) {
  return api('cancelOrder', { name });
}

function findPrice(name) {
  return (S.menuFlat.find(i => i.name === name) || {}).price || 0;
}
