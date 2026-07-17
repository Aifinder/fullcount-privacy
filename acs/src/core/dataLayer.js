// Data layer (§4). A deliberately simple, dependency-free JSON store so the
// reference implementation runs anywhere Node runs. In production each of
// these collections would be its own service/warehouse; the shape is what
// matters:
//
//   openers      -> Opener Library (§4)        the most valuable dataset
//   personas     -> Persona Store (§4)         voice + visual canon
//   content      -> Content Store (§4)         scripts, assets, publish records
//   performance  -> Performance Warehouse (§4) per-post metric time series
//   policyStore  -> Policy Store (§4)          platform rules, rate limits
//   stations     -> station registry + state machine snapshots
//   events       -> agent run logs / ops feed (§3 Ops view)
//   niches       -> niche catalog / demand signals (§2.2)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "..", "data", "db.json");

const EMPTY = {
  meta: { createdAt: null, seed: null, clock: 0 },
  niches: [],
  openers: [],
  personas: [],
  stations: [],
  content: [],
  performance: [], // one row per post: { postId, stationId, day, series:[], comments:[], winner }
  policyStore: [],
  events: [],
};

export class DataLayer {
  constructor(path = DB_PATH) {
    this.path = path;
    this.db = null;
  }

  load() {
    if (existsSync(this.path)) {
      this.db = JSON.parse(readFileSync(this.path, "utf8"));
    } else {
      this.db = structuredClone(EMPTY);
    }
    return this;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
    return this;
  }

  reset(seed) {
    this.db = structuredClone(EMPTY);
    this.db.meta.createdAt = new Date().toISOString();
    this.db.meta.seed = seed ?? Date.now();
    this.db.meta.clock = 0;
    return this;
  }

  // ---- generic collection helpers ----
  all(coll) {
    return this.db[coll];
  }
  find(coll, pred) {
    return this.db[coll].find(pred);
  }
  filter(coll, pred) {
    return this.db[coll].filter(pred);
  }
  insert(coll, row) {
    this.db[coll].push(row);
    return row;
  }
  byId(coll, id) {
    return this.db[coll].find((r) => r.id === id);
  }

  get meta() {
    return this.db.meta;
  }

  // ---- clock (§2.1 orchestrator schedules by day) ----
  get clock() {
    return this.db.meta.clock;
  }
  set clock(v) {
    this.db.meta.clock = v;
  }

  // ---- events / ops feed ----
  logEvent(evt) {
    const row = {
      id: this.db.events.length + 1,
      day: this.clock,
      ts: new Date().toISOString(),
      level: "info",
      ...evt,
    };
    this.db.events.push(row);
    // keep the log bounded so the file doesn't grow without limit
    if (this.db.events.length > 5000) {
      this.db.events.splice(0, this.db.events.length - 5000);
    }
    return row;
  }

  // ---- station convenience ----
  station(id) {
    return this.byId("stations", id);
  }
  performanceFor(stationId) {
    return this.db.performance.filter((p) => p.stationId === stationId);
  }
  postsFor(stationId) {
    return this.db.content.filter(
      (c) => c.stationId === stationId && c.kind === "post",
    );
  }
}
