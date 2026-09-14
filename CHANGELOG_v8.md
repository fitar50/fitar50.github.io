# فطار الشغل -- v8 changes

Applied 2026-09-12. Cache: `fitar-v8` / `?v=8`.

## Feature 1: InstaPay Payment Link

### What changed

The "رقم الإنستاباي" field in the manager payment config is now labeled
"لينك الإنستاباي" and accepts a full InstaPay URL (e.g.
`https://ipn.eg/S/kareemsa57/instapay/4QnL3m`) instead of a phone number.

When the stored value is a URL (starts with `http`), the user-facing payment
box on the submitted and closed screens renders a large tappable **"ادفع بالإنستاباي"**
button. Tapping it opens InstaPay on the phone with the recipient pre-populated.
The user enters their amount and sends.

When the stored value is a plain phone number (old data / fallback), the payment
box shows the number as text, same as before. No existing data breaks.

### InstaPay limitations

- **Amount cannot be prefilled.** InstaPay's `ipn.eg` share links have no
  documented query parameter for amount. The user sees their calculated total
  on the Fitar screen and types it into InstaPay manually.
- The link opens InstaPay via Android App Links / iOS Universal Links. If
  InstaPay is not installed, `ipn.eg` falls through to a web page.

### Files changed

| File | Change |
|---|---|
| `js/manager.js` | InstaPay input: `type="tel"` -> `type="url"`, placeholder `01xxx` -> `https://ipn.eg/S/...`, label updated, LTR direction, increased maxlength to 120 |
| `js/screens.js` | `_buildPaymentBox()` detects URL vs phone number; URLs render as a tappable `<a>` button |
| `css/additions.css` | `.instapay-link-btn` and `.pi-instapay-hint` styles |

### Backend

No backend changes. The `collector_instapay` config key and `names.instapay_number`
column already store arbitrary strings. A URL is just a longer string.

---

## Feature 2: Remember Selected User

### What changed

The browser remembers which name was last selected, using a single
`localStorage` key (`fitar_user`). On return visits the name screen is
skipped entirely -- the user goes straight to their current status:

| State on load | Where the user lands |
|---|---|
| Has order today | Submitted screen (order summary) |
| No order, last order exists on today's menu | Repeat screen ("same as last time?") |
| No order, no repeat available | Order screen (menu) |
| Ordering locked | Closed screen (with their order, if any) |
| Ordering not yet open | Not-open screen (waits for manager to open) |

When the manager opens ordering mid-session (detected via the 10s poll),
a remembered user on the not-open screen is automatically routed to ordering
without having to pick their name again.

### Clearing the remembered user

Both "← رجوع" (order screen back button) and "← تغيير الاسم" (submitted
screen link) use the `goBackToName` action, which now clears `fitar_user`
from localStorage. The name screen appears, and anyone on that device can
pick a different name.

### Edge cases handled

- **Name deleted/renamed in backend:** If the remembered name is no longer
  in the names list, localStorage is cleared and the name screen is shown.
- **Next-day reset:** localStorage only stores the name, never the order.
  The order comes from the server. After a reset, the remembered user sees
  the ordering screen (or repeat prompt), not yesterday's order.
- **Proxy ordering:** When Ahmed orders for Mohamed, `fitar_user` stays
  "Ahmed". The proxy flow does not overwrite the stored identity.
- **Ordering closed mid-session:** The poll handles this as before; the
  remembered user in localStorage is unaffected and will be used on next load.

### Files changed

| File | Change |
|---|---|
| `js/app.js` | `_saveRememberedUser`, `_loadRememberedUser`, `_clearRememberedUser` helpers; `init()` checks localStorage after data load and routes to correct screen; `proceedWithName()` saves the name; `goBackToName` clears it; poll ordering-open handler routes remembered users directly |

---

## Cache / deploy

| File | Change |
|---|---|
| `sw.js` | `CACHE_NAME` bumped to `fitar-v8` |
| `index.html` | All `?v=7` bumped to `?v=8` |

## Backend

No backend deployment needed for this release.
