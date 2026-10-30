// Manoeuvres, the sat-nav banner and checkpoints with UK driving tips.
// Pure logic: no Google or page code, so it can be tested on its own.

import { project, headingAt } from './geo.js';

export const PIN_TYPES = {
  roundabout: { label: 'Roundabout', icon: '⟳' },
  left: { label: 'Turn left', icon: '↰' },
  right: { label: 'Turn right', icon: '↱' },
  keep: { label: 'Lane choice', icon: '⇵' },
  merge: { label: 'Slip road / merge', icon: '⤴' },
  arrive: { label: 'Destination', icon: '⚑' },
  box: { label: 'Box junction', icon: '▦' },
  lane: { label: 'Lane change', icon: '⇄' },
  hazard: { label: 'Hazard', icon: '⚠' },
  tricky: { label: 'Tricky junction', icon: '✱' },
  other: { label: 'Note', icon: '•' },
};

// Types Luke can choose for his own pins.
export const OWN_TYPES = ['box', 'lane', 'hazard', 'tricky', 'roundabout', 'other'];

const TIPS = {
  roundabout: 'Mirrors, signal and get in lane early. Give way to traffic from your right.',
  left: 'Mirror, signal left, keep left and slow down. Check for cyclists on your left.',
  right: 'Mirror, signal right, position just left of the centre line. Wait for a safe gap; watch for people crossing.',
  keep: 'Read the lane signs early and move over in good time: mirror, signal, manoeuvre.',
  merge: 'Use the slip road to match speed. Mirrors and a shoulder check, then merge into a safe gap.',
  arrive: 'Look for a safe, legal place to stop. Mirrors, signal, then pull in.',
  box: "Don't enter the yellow box unless your exit is clear (you can wait in it to turn right if only oncoming traffic stops you).",
  lane: 'Check mirrors and blind spot before changing lane, and signal in good time.',
  hazard: 'Slow down early and be ready to stop.',
  tricky: 'Take it slowly: mirrors, signal, position, speed, look.',
  other: '',
};

// Banner arrow: slight turns and forks point the way they bend.
export function iconFor(m) {
  if (m.type === 'keep') return /\bleft\b/i.test(m.text) ? '↖' : /\bright\b/i.test(m.text) ? '↗' : '⇵';
  return PIN_TYPES[m.type]?.icon || '↑';
}

export function tipFor(type) {
  return TIPS[type] || '';
}

// Turns Google's manoeuvre name into one of our types.
export function typeOf(maneuver = '', text = '') {
  const m = maneuver.toUpperCase();
  if (m.startsWith('ROUNDABOUT') || /roundabout/i.test(text)) return 'roundabout';
  if (m.startsWith('RAMP') || m === 'MERGE' || /slip road|merge/i.test(text)) return 'merge';
  if (m.startsWith('FORK') || m.includes('SLIGHT') || /keep (left|right)/i.test(text)) return 'keep';
  if (m.includes('LEFT')) return 'left';
  if (m.includes('RIGHT')) return 'right';
  return null; // straight on, road name changes, depart: not worth a checkpoint
}

const clean = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();

// Signed turn from heading a to heading b: negative = left, positive = right.
function turn(a, b) {
  return ((b - a + 540) % 360) - 180;
}

// Lane advice, following the Highway Code's roundabout guidance.
function laneHint(type, exitTurn) {
  if (type === 'roundabout') {
    if (exitTurn < -45) return 'Left lane · signal left';
    if (exitTurn > 45) return 'Right lane · signal right, then left after the exit before yours';
    return 'Left lane (unless signs say otherwise) · signal left after the exit before yours';
  }
  if (type === 'left') return 'Keep left';
  if (type === 'right') return 'Just left of the centre line';
  if (type === 'keep') return 'Follow the lane signs';
  return '';
}

// Places each Google step on the route and works out its type and lane hint.
// Returns the manoeuvres in route order: [{ d, type, text, lane }].
export function manoeuvres(g, steps = []) {
  const out = [];
  let from = 0;
  const at = steps.map((s) => {
    if (!s.at) return null;
    const pr = project(g, s.at, Math.max(0, from - 5));
    if (pr) from = pr.d;
    return pr ? pr.d : null;
  });
  steps.forEach((s, i) => {
    if (i === 0 || at[i] == null) return; // first step is "head north" etc.
    // Google puts extra detail on later lines ("Continue to follow B4596").
    const [text, ...more] = clean(s.text).split(/\s*\n\s*/);
    const type = typeOf(s.maneuver, text);
    const d = at[i];
    let exitTurn = 0;
    if (type === 'roundabout') {
      const after = at[i + 1] ?? Math.min(g.total, d + 60);
      exitTurn = turn(headingAt(g, Math.max(0, d - 25), 20), headingAt(g, after, 20));
    }
    out.push({ d, type: type || 'straight', text, more: more.join(' · '), lane: type ? laneHint(type, exitTurn) : '' });
  });
  out.push({ d: g.total, type: 'arrive', text: 'Arrive at your destination', lane: '' });
  return out;
}

// What the sat-nav banner shows at distance d along the route.
export function bannerAt(list, d) {
  const next = list.find((m) => m.d > d - 8);
  if (!next) return null;
  return { ...next, inMetres: Math.max(0, next.d - d) };
}

let seq = 0;
export const newId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

// Starting checkpoints: one per real manoeuvre, each with a generic tip.
export function seedCheckpoints(list) {
  return list
    .filter((m) => m.type !== 'straight')
    .map((m) => ({
      id: newId(),
      d: m.d,
      type: m.type,
      title: m.text || PIN_TYPES[m.type].label,
      note: [m.more, m.lane, tipFor(m.type)].filter(Boolean).join('. '),
      auto: true,
      hidden: false,
    }));
}

// After the route changes: fresh auto checkpoints, Luke's own pins kept and
// moved onto the new line (dropped if the new route no longer goes near them).
export function mergeCheckpoints(g, old = [], seeded) {
  const own = old
    .filter((c) => !c.auto && c.lat != null)
    .map((c) => {
      const pr = project(g, c);
      return pr && pr.dist < 40 ? { ...c, d: pr.d } : null;
    })
    .filter(Boolean);
  return [...seeded, ...own].sort((a, b) => a.d - b.d);
}

// The checkpoint coming up within `ahead` metres, if any.
export function checkpointNear(cps = [], d, ahead = 60) {
  return cps.find((c) => !c.hidden && c.d >= d - 5 && c.d - d <= ahead) || null;
}
