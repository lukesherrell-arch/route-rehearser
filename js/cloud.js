// Cloud saving: keeps saved routes in one file (routes.json) in a PRIVATE
// GitHub repository, so the PC and the phone share them. Each device is
// given the repository name and a fine-grained token once; both stay in
// that browser only. The token should only have access to that one repository.

const FILE = 'routes.json';
const API = 'https://api.github.com';

// ---------- merging (no network; tested in tests/cloud.test.mjs) ----------

// Combines two copies of the route list. The newest copy of each route wins,
// and a route deleted after it was last saved stays deleted.
export function merge(a, b) {
  const deleted = { ...(a?.deleted || {}) };
  for (const [id, t] of Object.entries(b?.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const byId = new Map();
  for (const r of [...(a?.routes || []), ...(b?.routes || [])]) {
    if (!r?.id) continue;
    const have = byId.get(r.id);
    if (!have || (r.savedAt || 0) > (have.savedAt || 0)) byId.set(r.id, r);
  }
  const routes = [...byId.values()].filter((r) => !(deleted[r.id] >= (r.savedAt || 0)));
  return { routes, deleted };
}

// A fingerprint for "has anything changed?" checks.
export function fingerprint(data) {
  const r = (data?.routes || []).map((x) => `${x.id}@${x.savedAt || 0}`).sort();
  const d = Object.entries(data?.deleted || {}).map(([id, t]) => `${id}x${t}`).sort();
  return r.join(',') + '|' + d.join(',');
}

// Accepts "owner/name", or a pasted GitHub address.
export function parseRepo(text) {
  const m = String(text || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$|\/$/g, '')
    .match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// ---------- talking to GitHub ----------

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

class CloudError extends Error {}

async function gh(cfg, path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API}/repos/${cfg.repo}${path}`, {
      cache: 'no-store',
      ...opts,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
  } catch {
    throw new CloudError("Couldn't reach GitHub. Check your internet connection.");
  }
  if (res.status === 401) throw new CloudError('GitHub didn\'t accept the token. It may have expired: make a new one and connect again.');
  if (res.status === 403 && opts.method === 'PUT')
    throw new CloudError('The token can read but not save. Give it "Contents: Read and write" for this repository.');
  return res;
}

// Checks the repository and token work. Returns null if fine, or a message.
export async function check(cfg) {
  try {
    const res = await gh(cfg, '');
    if (res.status === 404)
      return `Can't see "${cfg.repo}". Check the name, and that the token was given access to that repository.`;
    if (!res.ok) return `GitHub said: ${res.status} ${res.statusText}`;
    const info = await res.json();
    if (!info.private) return `"${cfg.repo}" is public. Please make it private (Settings → Danger Zone → Change visibility) so your routes stay yours.`;
    return null;
  } catch (err) {
    return err.message;
  }
}

// Reads routes.json. Returns { data, sha } (data null if the file isn't there yet).
async function readFile(cfg) {
  const res = await gh(cfg, `/contents/${FILE}`);
  if (res.status === 404) {
    // Either no file yet (fine) or the repository can't be seen.
    const repo = await gh(cfg, '');
    if (repo.status === 404) throw new CloudError(`Can't see "${cfg.repo}". Check the name and the token's access.`);
    return { data: null, sha: null };
  }
  if (!res.ok) throw new CloudError(`GitHub said: ${res.status} ${res.statusText}`);
  const meta = await res.json();
  let text;
  if (meta.content && meta.encoding === 'base64') text = fromBase64(meta.content);
  else {
    // Files over 1 MB come without their content; ask for the raw file.
    const raw = await gh(cfg, `/contents/${FILE}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!raw.ok) throw new CloudError(`GitHub said: ${raw.status} ${raw.statusText}`);
    text = await raw.text();
  }
  try {
    return { data: JSON.parse(text), sha: meta.sha };
  } catch {
    throw new CloudError(`${FILE} in the repository isn't readable. Delete it there and press Sync now.`);
  }
}

async function writeFile(cfg, data, sha) {
  const body = {
    message: `Routes saved from ${/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'computer'}`,
    content: toBase64(JSON.stringify({ app: 'route-rehearser', version: 1, ...data })),
  };
  if (sha) body.sha = sha;
  const res = await gh(cfg, `/contents/${FILE}`, { method: 'PUT', body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 422) return false; // the other device saved meanwhile
  if (!res.ok) throw new CloudError(`GitHub said: ${res.status} ${res.statusText}`);
  return true;
}

// Brings this device and the cloud copy into line.
// local: { routes, deleted }. Returns { data, pulled, pushed }.
export async function sync(cfg, local) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: remote, sha } = await readFile(cfg);
    const merged = merge(local, remote);
    const pulled = fingerprint(merged) !== fingerprint(local);
    if (remote && fingerprint(merged) === fingerprint(remote)) return { data: merged, pulled, pushed: false };
    if (await writeFile(cfg, merged, sha)) return { data: merged, pulled, pushed: true };
  }
  throw new CloudError('The other device kept saving at the same moment. Try Sync now again.');
}
