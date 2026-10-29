# Route Rehearser: Handover

Written 29 Oct 2026 in Claude chat (AI Lab project). **Read this first.**

## What it is

A personal web app for Luke, a UK learner driver (Newport, Wales; UK roads, drive on the left), to rehearse A→B routes in Google Street View before driving them. The aim is to see each junction, roundabout and lane choice early and calmly, so decisions aren't made at the last second on lessons.

- Used on an **Android phone (Chrome)** and a **PC**. Phone-first layout.
- Luke has **no coding background**. Explain things in plain words, give setup steps click by click, and put short explanations on the screen itself.
- He prefers **rounds published one at a time** so he can test between them.

## Why it's better than Google Maps Street View

1. **Locked to the route.** Forward and back only ever move along the planned route, facing the direction of travel. There are no clickable arrows, so it never jumps to the other carriageway or a side road.
2. **Play, step or skip.** Step at his own pace, play at a chosen speed, or jump to the next checkpoint and skip dull straight stretches.
3. **Sat-nav banner and mini-map.** A "next manoeuvre" banner ("In 120 m · roundabout · 2nd exit · left lane") plus a normal-style (not satellite) heading-up mini-map, like a car sat-nav.
4. **Route line over the road.** A faded, game-style ribbon drawn over the Street View image showing where the route goes next. It can be toggled on and off.
5. **Checkpoints with tips.** Auto-seeded at every manoeuvre with generic UK tips (mirror–signal–position, lane choice, give way). Luke can add, edit or delete his own pins ("box junction: wait until exit clear").
6. **Library.** Saved routes he can reopen, review and extend.
7. **Usage meter.** Shows Google usage against the free caps, so there are no billing surprises.

## Cost model (verified from Google's pricing pages, 29 Oct 2026)

- **Dynamic Street View (Pro SKU):** billed per *instantiation* of a panorama object (`new google.maps.StreetViewPanorama()` / `map.getStreetView()`). 5,000 free per month.
- **Street View metadata / `StreetViewService.getPanorama`:** not charged (unlimited).
- **Dynamic Maps (mini-map):** one load per page; pan and zoom are free. 10,000 free per month.
- **Directions / Compute Routes Essentials:** 10,000 free per month. Call once per route build, then store the result.
- **Static Street View:** 10,000 free per month, but billed per image. **Don't use it for stepping.**

**Design rule:** create **one** `StreetViewPanorama` per session and move it with `setPano()` / `setPov()`. That should mean about 1 Street View charge per session, however much Luke steps, replays or looks around.

**Day-one check:** after the first real session, compare the Cloud console (Google Maps Platform → Metrics) with the in-app counter to confirm that stepping doesn't add charges. If it does, rethink before going further.

**Safety nets (set up in round 1, walking Luke through it):**
- Daily quota caps per API in Google Maps Platform → Quotas (for example Street View 150/day, Maps 150/day, Directions 50/day, Geocoding 100/day). Once a cap is hit, the API stops working rather than charging.
- A budget alert at £1.
- API key restricted to the app's URLs (the GitHub Pages address and localhost) and only the APIs used.

## Features

### 1. Route builder
- Enter From and To. Plain text plus geocoding is fine; avoid paid Places Autocomplete unless it's free in session mode.
- Use driving directions, region `GB`.
- **Via points** so Luke can force a specific way, e.g. by dragging the route on the map or tapping to add a via point. Directions picks the fastest route, which may not be the one his instructor uses.
- Save the route: name, from/to, via points, polyline, steps.

### 2. Route-locked stepping
- Sample the route polyline every ~8–10 m.
- For each sample, call `StreetViewService.getPanorama({location, radius: ~20, source: OUTDOOR, preference: NEAREST})`.
- **Picking the right image (the main risk):**
  - Prefer following the panorama `links` from the previous image, choosing the link whose heading is closest to the route bearing.
  - Reject images too far from the polyline or on the wrong side of a dual carriageway. In the UK the travel carriageway is on the left of the centreline.
  - Remove duplicates.
- Precompute the image list once per route and store it with the route. If Google's terms don't allow storing pano IDs, recompute it each time, which is free.
- **Gaps:** mark stretches with no usable image (more than ~50 m) and show them as grey on the scrubber.
- **Stepping:**
  - `setPano(id)`, with heading set to the route bearing at that point and pitch about −8°.
  - Disable `linksControl`, `clickToGo` and the address control so taps can't wander off the route.
  - Dragging to look around is allowed; a Recentre button snaps the view back to the route heading.
- Show the image date (`imageDate`) small in a corner.

### 3. Controls
- Step back, Play/Pause (speed 1×–8×), Step forward.
- Previous/Next checkpoint.
- Scrubber with checkpoint ticks and gap shading.
- Route line toggle.

### 4. Sat-nav banner and mini-map
- **Banner:** next manoeuvre icon, distance countdown, instruction and lane hint.
- **Mini-map:** normal road style (not satellite), heading-up, route line, car arrow. Tap to expand. Heading-up or tilt may need a vector map with a map ID.

### 5. Route line overlay (toggle)
- A canvas over the panorama.
- For route points ahead (up to ~150 m), compute the bearing and ground distance from the camera. The camera is ~2.5 m above the road, so elevation angle = atan(−2.5 / d).
- Project into the screen using the current POV heading, pitch and zoom (field of view from zoom; calibrate against a known kerb line).
- Draw a ribbon that narrows and fades with distance.
- Redraw on `pov_changed` and `pano_changed`.
- It assumes flat ground; small drift on hills is acceptable.

### 6. Checkpoints
- **Auto-seeded** from the directions steps (roundabout, turn, merge, fork, keep left/right, slip road), each with a short generic UK tip. Examples:
  - Roundabout lane choice by exit, following the Highway Code's roundabout guidance.
  - Mirror–signal–position–speed–look.
  - Give way.
  - Being ready to stop at box junctions.
- **Luke's own pins:** "Pin here" at the current position, with a type (box junction, lane change, hazard, tricky junction, other), a title and a note. Edit, delete, hide.
- Seeded checkpoints can be deleted or edited too.
- **Later:** enrich from OpenStreetMap (Overpass) lane tags (`turn:lanes`) for lane-by-lane hints where mapped.

### 7. Library
- List of saved routes: name, from/to, date, number of checkpoints.
- Open, rename, duplicate, delete.
- Stored in IndexedDB or localStorage on each device.
- Export and import as a JSON backup, so routes can move between phone and PC.
- Street View images themselves are **not** stored (Google's terms); they reload each session.

### 8. Usage meter
- The app counts its own billable events per calendar month: panoramas created, map loads, directions, geocodes.
- Shows them against the free caps, e.g. "Street View 3 / 5,000".
- Can be hidden in settings.
- Explain on screen that it counts this device only; the Cloud console is the true figure.

## Hosting and stack

- A static site on **GitHub Pages**. It opens in phone Chrome and can be added to the home screen.
- Keep it simple: plain HTML/JS, or a small Vite build if Claude Code thinks it's worth it.
- A Maps JS API key in the page is normal for this kind of site; it must be URL-restricted and quota-capped.
- It won't work as a claude.ai artifact: artifacts can't load Google's maps script.

## Build rounds

1. **Setup and core.**
   - Walk Luke through creating the Google Cloud project, billing, key restrictions, quotas and budget alert.
   - Build: route builder with via points, the route-locked stepping with gap marking, basic controls, the usage counter, and saving one route.
   - Do the day-one billing check.
2. **Sat-nav layer.** Banner, mini-map, auto checkpoints, own pins, full library, export/import.
3. **Feel.** Route line overlay, play and fast-forward tuning, skip to checkpoint, recentre.
4. **Later ideas:**
   - Quiz mode: pause before each checkpoint, ask "Which lane?", then reveal.
   - A "tricky junctions" drill list.
   - OSM lane data.
   - Import a route from a Google Maps link or GPX, e.g. test routes Luke learns later.
   - Mapillary as a fallback where Google imagery is missing.

## Risks to test early

- Wrong-side or sporadic image jumps on some roads. Test on real local routes; gaps may simply be missing imagery.
- Smoothness when playing: moving one panorama with `setPano` may flash between images. Tune the interval, or skip to fewer images when playing fast.
- Overlay accuracy.
- Old imagery (show the date).

## Context

- DVSA doesn't publish test routes; commercial apps sell community-made ones. Luke mainly wants his own local A→B routes and the spots he finds hard.
- Previous Claude builds of Luke's (e.g. MouthBox) went well when published in small rounds with plain-language on-screen help.
