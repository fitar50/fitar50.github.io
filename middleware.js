// middleware.js
const NOTE_MAX_LEN = 200;

// Strip alef variants and trim — mirrors the GAS normAr() used for name deduplication.
// Both the frontend and backend use this so Arabic name variants don't create duplicates.
function normAr(s) {
  return String(s || '').replace(/[إأآ]/g, 'ا').trim();
}

// Throws an Arabic error if ref doesn't match MGR_CODE env var.
function checkMgr(ref) {
  const stored = process.env.MGR_CODE || '';
  if (!stored || String(ref || '') !== stored) {
    throw new Error('غير مصرح');
  }
}

// Validates submitted items against the live menu:
//   - Drops any item not on the menu
//   - Forces the authoritative price from the DB (blocks client price tampering)
//   - Floors qty to integer, drops if < 1
//   - Trims and caps notes at NOTE_MAX_LEN chars
// db param is the pg Pool.
async function cleanItems(db, rawItems) {
  const { rows } = await db.query('SELECT name, price FROM menu');
  const priceMap = {};
  rows.forEach(r => { priceMap[normAr(r.name)] = { name: r.name, price: r.price }; });

  const out = [];
  (rawItems || []).forEach(it => {
    if (!it || !it.name) return;
    const menuItem = priceMap[normAr(it.name)];
    if (!menuItem) return;
    const qty = Math.floor(Number(it.qty) || 0);
    if (qty < 1) return;
    const clean = { name: menuItem.name, qty, price: menuItem.price };
    if (it.note) {
      const note = String(it.note).trim().slice(0, NOTE_MAX_LEN);
      if (note) clean.note = note;
    }
    out.push(clean);
  });
  return out;
}

module.exports = { normAr, checkMgr, cleanItems };
