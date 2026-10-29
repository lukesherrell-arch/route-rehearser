// Works out which Street View image to show at each point along the route.
// Talks to Google only through the two lookup functions passed in, so the
// logic can be tested without Google.
//
// lookupNear(latLng, radius) and lookupById(panoId) both resolve to
//   { pano, lat, lng, date, links: [{ pano, heading }] }  or null.
// These lookups are Street View *metadata*, which Google doesn't charge for.

import { project, pointAt, headingAt, sampleDistances, angleDiff } from './geo.js';

export const SETTINGS = {
  step: 10, // metres between route samples
  radius: 25, // search radius for each sample
  maxRight: 7, // further right than this = probably the other carriageway (UK, drive on left)
  maxLeft: 14, // further left than this = probably a side road or car park
  window: 60, // only match an image to the route within this distance of where we looked
  gapMin: 50, // a stretch longer than this with no image is marked as a gap
  fillFrom: 25, // try to fill holes bigger than this by following Google's links
  concurrency: 6,
};

// Checks an image against the route. Returns it with its distance along the
// route (d) and camera heading, or null if it isn't on our side of our road.
export function judge(g, img, dMin, dMax, s = SETTINGS) {
  if (!img) return null;
  const pr = project(g, img, dMin, dMax);
  if (!pr) return null;
  if (pr.side > s.maxRight || pr.side < -s.maxLeft) return null;
  return { ...img, d: pr.d, side: pr.side };
}

async function pool(items, n, fn, onEach) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
      done++;
      onEach?.(done, items.length);
    }
  });
  await Promise.all(workers);
}

export async function buildImageList(g, { lookupNear, lookupById, onProgress }, s = SETTINGS) {
  const samples = sampleDistances(g, s.step);
  const found = new Map(); // pano id -> judged image

  // Pass 1: nearest image to every sample point.
  await pool(
    samples,
    s.concurrency,
    async (d) => {
      const img = await lookupNear(pointAt(g, d), s.radius).catch(() => null);
      const ok = judge(g, img, d - s.window, d + s.window, s);
      if (ok && !found.has(ok.pano)) found.set(ok.pano, ok);
    },
    (done, total) => onProgress?.(done, total)
  );

  let list = tidy([...found.values()]);

  // Pass 2: where there's a hole, follow Google's own links from the image
  // before it, choosing the link that points most along the route.
  const filled = [];
  for (let i = 0; i <= list.length; i++) {
    const prev = list[i - 1];
    const nextD = i < list.length ? list[i].d : g.total;
    if (prev && nextD - prev.d > s.fillFrom) {
      let cur = prev;
      for (let k = 0; k < 15; k++) {
        const want = headingAt(g, cur.d);
        const link = (cur.links || [])
          .filter((l) => l.pano && angleDiff(l.heading, want) < 60 && !found.has(l.pano))
          .sort((a, b) => angleDiff(a.heading, want) - angleDiff(b.heading, want))[0];
        if (!link) break;
        const img = await lookupById(link.pano).catch(() => null);
        const ok = judge(g, img, cur.d - 5, cur.d + 60, s);
        if (!ok || ok.d <= cur.d + 2 || ok.d >= nextD - 3) break;
        found.set(ok.pano, ok);
        filled.push(ok);
        cur = ok;
      }
    }
  }
  if (filled.length) list = tidy([...list, ...filled]);

  for (const img of list) img.heading = headingAt(g, img.d);
  return { images: list, gaps: findGaps(list, g.total, s.gapMin) };
}

// Sorts by distance along the route and drops near-duplicates.
function tidy(list) {
  list.sort((a, b) => a.d - b.d);
  const out = [];
  for (const img of list) {
    const last = out[out.length - 1];
    if (last && img.d - last.d < 3) {
      // Keep whichever sits closer to the route line.
      if (Math.abs(img.side) < Math.abs(last.side)) out[out.length - 1] = img;
      continue;
    }
    out.push(img);
  }
  return out;
}

export function findGaps(list, total, gapMin) {
  const gaps = [];
  let prevD = 0;
  for (const img of list) {
    if (img.d - prevD > gapMin) gaps.push({ from: prevD, to: img.d });
    prevD = img.d;
  }
  if (total - prevD > gapMin) gaps.push({ from: prevD, to: total });
  return gaps;
}
