const RAILWAY_URL     = 'https://fitar-production.up.railway.app';
const MGR_PARAM       = 'mgr';
const SUPER_MGR_PARAM = 'supermgr';

// NOTE: DELIVERY_FEE was removed. The fee is server-driven (per restaurant,
// with an optional daily override set by the manager) and lives in
// S.deliveryFee, populated by initLoad() and refreshed by the 10s poll.

// ── Per-person rounding ──────────────────────────────────────────────────────
// Each person's total (food + their delivery share) is rounded to a clean
// multiple so they can send a constant amount without checking the fraction.
// Rounds UP to the next multiple of ROUNDING_STEP, UNLESS the amount is only
// within ROUND_DOWN_SLACK of the lower multiple, in which case it rounds down
// (26 -> 25, 27 -> 30). A positive debt never rounds to 0.
// IMPORTANT: only PEOPLE pay rounded amounts. The RESTAURANT is always paid the
// exact unrounded sum, so no rounded figure may enter buildRestaurantText().
// Set ROUNDING_STEP = 0 to turn rounding off (totals shown to the piaster).
const ROUNDING_STEP    = 5;
const ROUND_DOWN_SLACK = 1.5;
