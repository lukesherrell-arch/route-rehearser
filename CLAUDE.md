# Route Rehearser: notes for Claude

Read this first, then `route-rehearser-HANDOVER.md` (the original plan, plus a "Status" section with what was learned while building) and `README.md` (what each round added, and the file layout).

## Who and how

- Luke is a UK learner driver in Newport, Wales. **No coding background.** Keep explanations plain and short. Give setup steps click by click, one step at a time, and wait for him between steps.
- He uses the app mainly on his **PC** (Chrome), sometimes on an Android phone. Design for a wide screen first, and keep the phone layout working.
- He likes work in **rounds**, each live so he can test before the next one.
- He wants the sat-nav side to look as close as possible to **Google Maps' in-car navigation**. He does **not** want a manual lane picker.
- His home area is personal. Never put his addresses or saved routes in this public repo.

## Where things are

- Live site: https://lukesherrell-arch.github.io/route-rehearser/
- GitHub Pages currently serves the branch `claude/dazzling-albattani-pql92v`, root folder. Moving it to `main` has been explained to Luke but not done; he needs to approve it.
- Plain HTML/CSS/ES modules, no build step. `js/config.js` holds the Google key (restricted to his github.io site) and the vector Map ID.
- Google Cloud project "Route Rehearser". APIs enabled and allowed on the key: Maps JavaScript API, Routes API, Places API (New). Budget alert £1. Google won't let this account set daily quotas, so the app has its own daily limits (`DAILY_LIMIT` in `js/usage.js`).

## Rules that matter

- **One `StreetViewPanorama` per page visit**, moved with `setPano()`. Confirmed on Google's billing report: stepping isn't charged. Never create more panoramas, and never use the Static Street View API for stepping.
- Street View metadata look-ups (`StreetViewService.getPanorama`) are free. Every billable call goes through `js/google.js` and is counted in `js/usage.js`.
- Lane, speed-limit and signal data come from OpenStreetMap (Overpass API) in `js/osm.js`. Coverage is patchy, so the app must work without it.
- `VERSION` in `js/app.js` is shown to Luke in Help. Update it with each round.

## Testing

- `node --test tests/*.test.mjs` runs the logic tests, with no Google needed.
- The cloud session can reach `maps.googleapis.com`, so real-Google checks work. Serve the files with Playwright's `page.route` under the `https://lukesherrell-arch.github.io/route-rehearser/` address so the key's website restriction accepts them. Each check costs a few map loads, so keep them few.
- The cloud session **cannot** reach overpass-api.de, so OpenStreetMap results must be checked by Luke.
- Headless Chromium here has no WebGL, so the tilted vector mini-map can't be seen in screenshots.

## Open items (as of 18 Nov 2026)

- Luke hasn't yet reported the **Checkpoints → Road details** counts, which would confirm OpenStreetMap works on real routes, or whether address suggestions appear.
- Requested next: a **random route generator**. It takes a start, a radius in miles and/or a target travel time, for practising driving around an area.
- Requested next: **cloud saving of routes**, so PC and phone share them. Recommended option: a separate **private** GitHub repo written via a fine-grained token, entered once per device. Google Drive is the alternative.
- Later ideas: quiz mode, a tricky-junction drill, moving Pages to `main`, an optional passcode screen.
