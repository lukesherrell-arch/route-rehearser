# Route Rehearser

A personal web app for rehearsing A→B driving routes in Google Street View before driving them.
See `route-rehearser-HANDOVER.md` for the full plan.

**Live site:** https://lukesherrell-arch.github.io/route-rehearser/

## Round 1 (this version)
- Route builder: From / To, plus tap-to-add via points (drag the numbered pins to move them).
- Rehearse: steps along the route in Street View, locked to the route and facing the way you drive. Grey on the slider = no imagery.
- Controls: step back / forward, play at 1×–8×, slider, Recentre.
- Usage counter (this device, this month) and saved routes.

## Round 2
- Sat-nav banner: next manoeuvre, distance countdown, lane hint (Highway Code roundabout guidance).
- Mini-map that follows you (tap to enlarge). North-up, or heading-up if `mapId` in `js/config.js` is a vector Map ID.
- Checkpoints: auto-made at each junction with a UK tip; add your own with "Pin here"; edit, hide or delete any.
- Routes library: open, rename, copy, delete; export/import a backup file to move routes between devices.

## Files
- `index.html`, `css/app.css` — the page
- `js/app.js` — screens and buttons
- `js/google.js` — every Google call (and the usage counting)
- `js/imagery.js`, `js/geo.js` — picking the right Street View image for each point
- `js/checkpoints.js` — manoeuvres, banner, checkpoints and tips
- `js/config.js` — the Google key (restricted to this site)

Tests (no Google needed): `node --test tests/*.test.mjs`
