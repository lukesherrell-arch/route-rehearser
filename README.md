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

## Round 3
- Route line drawn over the Street View picture (toggle with **Line**). Drawn in the lane Google's camera car used, not on the road's centre line. Assumes flat ground.
- Previous / next checkpoint buttons (⏮ ⏭, or up/down arrow keys).
- Play speeds 1×–4×: faster speeds take bigger jumps, not shorter looks, and slow to every picture near a checkpoint.
- Roundabout lane advice measured from where the exit road straightens out.

## Round 4 (sat-nav)
- On a wide screen the sat-nav is a panel beside the picture: banner, heading-up tilted map with a navigation arrow, speed limit sign, distance to go. ⤡ shrinks it.
- Lane arrows (with the lanes to use lit up), speed limits, traffic lights, crossings, give-way/stop signs and speed cameras from OpenStreetMap (Overpass API, free, no key). Fetched once per route and saved with it.
- Address suggestions while typing (Places API (New), `AutocompleteSuggestion`). Turns itself off quietly if the API isn't enabled.
- Miles and yards by default (setting in Help), carries on where you stopped, old-picture warning, "Refresh tips and road details" button, slimmer layout for a phone held sideways.

## Files
- `index.html`, `css/app.css` — the page
- `js/app.js` — screens and buttons
- `js/google.js` — every Google call (and the usage counting)
- `js/imagery.js`, `js/geo.js` — picking the right Street View image for each point
- `js/checkpoints.js` — manoeuvres, banner, checkpoints and tips
- `js/overlay.js` — the maths for the route line over Street View
- `js/osm.js` — lanes, speed limits and signals from OpenStreetMap
- `js/units.js` — yards/miles or metres/km
- `js/config.js` — the Google key (restricted to this site)

Tests (no Google needed): `node --test tests/*.test.mjs`
