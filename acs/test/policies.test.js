// Tests for the article's HARD behavioral rules. These are the constraints
// that turn a solo playbook into a governed system — if they regress, the
// whole premise breaks, so they're tested directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { POLICY, canSwitchNiche, monetizationEligibility, phaseForDay } from "../src/core/policies.js";
import { jaccardSimilarity, median, isoWeek } from "../src/core/util.js";

test("no niche switch before day 30", () => {
  assert.equal(canSwitchNiche({ currentDay: 10 }), false);
  assert.equal(canSwitchNiche({ currentDay: 29 }), false);
  assert.equal(canSwitchNiche({ currentDay: 30 }), true);
});

test("monetization gated before day 60 even with strong trust signals", () => {
  const strong = { currentDay: 59, followers: 50000, repeatEngagers: 100, meanCommentQuality: 0.9 };
  const res = monetizationEligibility(strong);
  assert.equal(res.eligible, false);
  assert.ok(res.reasons.some((r) => r.includes("< 60")));
});

test("monetization requires trust thresholds even after day 60", () => {
  const thin = { currentDay: 70, followers: 10, repeatEngagers: 1, meanCommentQuality: 0.1 };
  const res = monetizationEligibility(thin);
  assert.equal(res.eligible, false);
  assert.ok(res.reasons.length >= 3);
});

test("monetization opens when day + all trust gates met", () => {
  const ready = { currentDay: 61, followers: 2000, repeatEngagers: 20, meanCommentQuality: 0.6 };
  assert.equal(monetizationEligibility(ready).eligible, true);
});

test("phase boundaries mirror the 30-day arc", () => {
  assert.equal(phaseForDay(2), "bootstrap");
  assert.equal(phaseForDay(6), "research");
  assert.equal(phaseForDay(12), "remix");
  assert.equal(phaseForDay(27), "original");
  assert.equal(phaseForDay(45), "growth");
  assert.equal(phaseForDay(90), "monetization");
});

test("originality guard: title+opener may match, body may not", () => {
  const source = "5 budget tips that actually work Stop doing your budget the hard way.";
  const verbatimReupload = source; // a lazy reupload
  const properRemix = "Mara here — the time I wasted a weekend on saving. Here's what moved the needle: my three picks.";
  assert.ok(jaccardSimilarity(verbatimReupload, source) > POLICY.MAX_BODY_SIMILARITY_TO_SOURCE);
  assert.ok(jaccardSimilarity(properRemix, source) <= POLICY.MAX_BODY_SIMILARITY_TO_SOURCE);
});

test("winner detection is relative (median-based)", () => {
  const stationViews = [120, 150, 90, 200, 140];
  const m = median(stationViews);
  assert.ok(400 >= m * POLICY.WINNER_MEDIAN_MULTIPLE); // 400 vs ~140 median => winner
  assert.ok(!(200 >= m * POLICY.WINNER_MEDIAN_MULTIPLE)); // 200 is not
});

test("week bucketing groups days for dedup", () => {
  assert.equal(isoWeek(8), isoWeek(13));
  assert.notEqual(isoWeek(8), isoWeek(15));
});
