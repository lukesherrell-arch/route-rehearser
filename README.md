# Route Rehearser

A personal web app for rehearsing A→B driving routes in Google Street View before driving them.
See `route-rehearser-HANDOVER.md` for the full plan.

**Live site:** https://lukesherrell-arch.github.io/route-rehearser/

## Round 1 (this version)
- Route builder: From / To, plus tap-to-add via points (drag the numbered pins to move them).
- Rehearse: steps along the route in Street View, locked to the route and facing the way you drive. Grey on the slider = no imagery.
- Controls: step back / forward, play at 1×–8×, slider, Recentre.
- Usage counter (this device, this month) and saved routes.

## Files
- `index.html`, `css/app.css` — the page
- `js/app.js` — screens and buttons
- `js/google.js` — every Google call (and the usage counting)
- `js/imagery.js`, `js/geo.js` — picking the right Street View image for each point
- `js/config.js` — the Google key (restricted to this site)

Tests (no Google needed): `node --test tests/*.test.mjs`
