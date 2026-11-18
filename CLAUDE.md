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
- Cloud saving (`js/cloud.js`) talks to api.github.com straight from the browser with Luke's fine-grained token, stored in localStorage (`rr.settings.cloud`) on each device. Data repo: private `route-rehearser-data` that Luke creates himself (this session's GitHub tools can't create repos). Deletions are kept as tombstones (`rr.deleted`) so they sync.
- Random routes (`js/random.js` + `makeRandom` in `js/app.js`): a typed start costs one extra route call (no Geocoding API), then up to 4 route calls.
- Lane, speed-limit and signal data come from OpenStreetMap (Overpass API) in `js/osm.js`. Coverage is patchy, so the app must work without it.
- `VERSION` in `js/app.js` is shown to Luke in Help. Update it with each round.

## Testing

- `node --test tests/*.test.mjs` runs the logic tests, with no Google needed.
- The cloud session can reach `maps.googleapis.com`, so real-Google checks work. Serve the files with Playwright's `page.route` under the `https://lukesherrell-arch.github.io/route-rehearser/` address so the key's website restriction accepts them. Each check costs a few map loads, so keep them few.
- The cloud session **cannot** reach overpass-api.de, so OpenStreetMap results must be checked by Luke.
- Headless Chromium here has no WebGL, so the tilted vector mini-map can't be seen in screenshots.

## Open items (as of 18 Nov 2026, after Round 5)

- Address suggestions confirmed working (18 Nov). Road details mostly said "couldn't reach OpenStreetMap". Round 5.1 switched `js/osm.js` from one heavy `around:` line query to small bounding boxes along the route, added more servers and a retry, and shows the real error in Checkpoints. Luke confirmed it works (B&Q route: 5 lane stretches, 5 limits, 11 spots) but took over a minute; offered to race servers in parallel. Round 5.2 added green lane-arrow bars on the slider and Go buttons in Checkpoints.
- Luke created the private `route-rehearser-data` repo (18 Nov). PC connected and verified (routes.json read back via the data repo). Phone not set up yet; Luke will come back to it (needs a second token).
- Round 5 built the **random route generator** and **cloud saving** (GitHub). Waiting on Luke to connect both devices and say how the random routes feel (they can include short in-and-out spurs where a random spot lands on a side road).
- Later ideas: quiz mode, a tricky-junction drill, moving Pages to `main`, an optional passcode screen.
