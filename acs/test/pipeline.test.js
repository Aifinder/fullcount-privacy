// End-to-end tests over the orchestrator + all agents, using an isolated
// on-disk store so they don't clobber the dev data/db.json.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { DataLayer } from "../src/core/dataLayer.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { ComplianceAgent } from "../src/agents/compliance.js";
import { POLICY } from "../src/core/policies.js";

function freshDb() {
  const path = join(tmpdir(), `acs-test-${Math.random().toString(36).slice(2)}.json`);
  const db = new DataLayer(path).reset(1234);
  return { db, path };
}

function build(stations = 5, days = 65) {
  const { db, path } = freshDb();
  const orch = new Orchestrator(db);
  for (let i = 0; i < stations; i++) orch.createStation(i);
  for (let d = 0; d < days; d++) orch.tick();
  return { db, orch, path };
}

test("stations ship posts and post-count is the tracked KPI", () => {
  const { db, path } = build(5, 65);
  const stations = db.all("stations");
  const totalPosts = stations.reduce((a, s) => a + s.postsShipped, 0);
  assert.ok(totalPosts > 100, `expected >100 posts, got ${totalPosts}`);
  // no posting before the remix phase (day 8)
  const earlyPosts = db.all("performance").filter((p) => p.day < 8);
  assert.equal(earlyPosts.length, 0);
  rmSync(path, { force: true });
});

test("no monetization proposal is created before day 60", () => {
  const { db, path } = build(5, 55); // stop before day 60
  const offers = db.all("events").filter((e) => e.msg?.includes("offer proposal ready"));
  assert.equal(offers.length, 0);
  rmSync(path, { force: true });
});

test("monetization proposals appear only after the day-60 gate", () => {
  const { db, path } = build(6, 65);
  const proposals = db.all("events").filter((e) => e.msg?.includes("offer proposal ready"));
  // at least one station crosses the gate in a 65-day run
  assert.ok(proposals.length >= 1, "expected at least one offer proposal after day 60");
  // and every proposal event is at day >= 60
  for (const e of proposals) assert.ok(e.day >= 60);
  rmSync(path, { force: true });
});

test("openers are never remixed by two stations in the same week", () => {
  const { db, path } = build(8, 40);
  for (const o of db.all("openers")) {
    const byWeek = {};
    for (const u of o.usedBy) {
      byWeek[u.week] = (byWeek[u.week] || new Set());
      byWeek[u.week].add(u.stationId);
    }
    for (const [week, set] of Object.entries(byWeek)) {
      assert.equal(set.size, 1, `opener ${o.id} used by ${set.size} stations in week ${week}`);
    }
  }
  rmSync(path, { force: true });
});

test("all mined openers meet the >=1M source-view floor", () => {
  const { db, path } = build(4, 20);
  for (const o of db.all("openers")) {
    assert.ok(o.views >= POLICY.MIN_SOURCE_VIEWS_WHEN_NO_WINNERS);
  }
  rmSync(path, { force: true });
});

test("every published post carries an AI-content disclosure label", () => {
  const { db, path } = build(4, 30);
  const posts = db.all("content").filter((c) => c.kind === "post");
  assert.ok(posts.length > 0);
  for (const p of posts) assert.equal(p.disclosure, "AI-generated");
  rmSync(path, { force: true });
});

test("kill switch stops a station from posting further", () => {
  const { db, orch, path } = build(3, 30);
  const s = db.all("stations")[0];
  const before = s.postsShipped;
  new ComplianceAgent(db).killStation(s, "test");
  for (let d = 0; d < 10; d++) orch.tick();
  assert.equal(s.status, "killed");
  assert.equal(s.postsShipped, before, "killed station must not ship new posts");
  rmSync(path, { force: true });
});

test("winners are recorded relative to the station's own trailing median", () => {
  const { db, path } = build(5, 65);
  const winners = db.all("performance").filter((p) => p.winner);
  for (const w of winners) {
    assert.ok(w.finalViews >= w.stationMedianAtPost * POLICY.WINNER_MEDIAN_MULTIPLE);
  }
  rmSync(path, { force: true });
});
