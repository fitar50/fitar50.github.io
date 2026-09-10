# Frontend suites

Run the real `index.html` in a real DOM (jsdom) with the API stubbed. No mocks
of the app's own code: actual clicks, actual renderers, actual event delegation.

## Run

```bash
cd fitar50.github.io-main/tests
npm install jsdom --no-save --silent
node run.js && node cache.js && node focus.js && node closed.js && node rounding.js
```

| File | Covers | Assertions |
|---|---|---|
| `run.js` | Name/order screens, note chips, manager dashboard, super manager, `deliverySplit` | 48 |
| `cache.js` | SW registration, asset versioning, no reload loop | 9 |
| `focus.js` | Typing survives the 10s dashboard refresh | 4 |
| `closed.js` | Post-lock collector change, reset detection (~35s, real poll timing) | 6 |
| `rounding.js` | Per-person rounding rule + guards, collected/surplus math, no rounded figure in the restaurant text | 25 |

**92 assertions.** `api.json` holds the stubbed API responses.

## Two things that will trip you up

1. **`S` is not on `window`.** It is declared `const`, so it is a lexical
   global. Read it with `w.eval('S')`, not `w.S`.
2. **The 150ms click debounce eats programmatic clicks.** Space simulated clicks
   ~200ms apart or you will chase phantom failures. Actions in `NO_DEBOUNCE`
   (qty, chips, toggles) are exempt.

## What these do NOT cover

jsdom has no layout engine. Nothing here verifies that note chips wrap at
380px, or that the fee input fits the restaurant header. Visual checks need a
real phone.
