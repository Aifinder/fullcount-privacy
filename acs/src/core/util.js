// Small shared utilities: deterministic RNG, ids, math helpers.
// Determinism matters here: the simulation must be reproducible so the
// dashboard, tests, and winner-detection logic all agree run to run.

// Mulberry32 — tiny seedable PRNG. Same seed => same stream.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive a stable numeric seed from any string (station id, niche, day…).
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Seeded RNG keyed by an arbitrary label — lets each concern draw its own
// reproducible stream without threading a generator through every call.
export function seededRng(...parts) {
  return makeRng(hashSeed(parts.join("|")));
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickN(rng, arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function shortId(prefix, rng) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(rng() * chars.length)];
  return `${prefix}_${s}`;
}

// Very cheap text-similarity (token Jaccard). Used by the compliance agent's
// originality guard to cap how close a remix body is to its source.
export function jaccardSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size && !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function wordCount(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

export function isoWeek(day) {
  // "Week bucket" for dedup — day is an integer sim-day; group by 7.
  return Math.floor(day / 7);
}
