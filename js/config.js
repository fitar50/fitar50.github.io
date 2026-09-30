const RAILWAY_URL     = 'https://newfitarbackend-production.up.railway.app';
const MGR_PARAM       = 'mgr';
const SUPER_MGR_PARAM = 'supermgr';

// NOTE: DELIVERY_FEE was removed. The fee is server-driven (per restaurant,
// with an optional daily override set by the manager) and lives in
// S.deliveryFee, populated by initLoad() and refreshed by the 10s poll.

// ── Per-person rounding ──────────────────────────────────────────────────────
// Each person's total (food + their delivery share) is rounded to the NEAREST
// multiple of ROUNDING_STEP (halves round up: 16/17 -> 15, 18/19 -> 20, 17.5 ->
// 20) so they can hand over a clean amount the delivery guy can make change for.
// The delivery figure shown to a user is then derived as total - food (see
// personBreakdown in utils.js), so the visible breakdown always adds up. People
// may see different delivery figures — that is expected and fine.
// IMPORTANT: only PEOPLE pay rounded amounts. The RESTAURANT is always paid the
// exact unrounded sum, so no rounded figure may enter buildRestaurantText().
// Set ROUNDING_STEP = 0 to turn rounding off (totals shown to the piaster).
const ROUNDING_STEP = 5;
