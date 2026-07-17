// §2.8 Engagement Agent.
// The article's cheapest growth hack, encoded precisely: reply to EVERY comment
// inside the first 2 hours, in the persona's voice. At hour 2, check view
// velocity — still growing => keep replying; flat => stop and reallocate.
// Safety filters skip spam/abuse and escalate sensitive comments to HITL.
// Reply cadence is throttled to a human-plausible rate.

import { POLICY } from "../core/policies.js";
import { seededRng, pick } from "../core/util.js";

export class EngagementAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Runs against a post's simulated comment set and velocity series.
  run(station, persona, post, perf) {
    const rng = seededRng("engage", post.id);
    const replies = [];
    const escalations = [];
    let skipped = 0;
    let repliesThisHour = {};

    // Only comments arriving inside the 2h window are eligible for the
    // guaranteed reply-to-all behavior.
    const windowComments = perf.comments.filter((c) => c.atHour < POLICY.ENGAGEMENT_WINDOW_HOURS);

    for (const c of windowComments) {
      // Safety filters (§2.8 / §6.9).
      if (c.kind === "spam") {
        skipped++;
        continue;
      }
      if (c.kind === "abuse") {
        // don't take the bait; escalate the borderline ones to HITL
        if (c.quality > 0.03 && rng() < 0.3) escalations.push({ comment: c, reason: "sensitive" });
        skipped++;
        continue;
      }
      // Throttle: cap replies per hour to stay human-plausible.
      repliesThisHour[c.atHour] = (repliesThisHour[c.atHour] || 0) + 1;
      if (repliesThisHour[c.atHour] > POLICY.MAX_REPLIES_PER_HOUR) {
        skipped++;
        continue;
      }
      replies.push({
        commentId: c.id,
        text: this._reply(persona, c, rng),
        atHour: c.atHour,
      });
    }

    // 2-hour velocity decision (§2.8).
    const decision = this._velocityDecision(perf);

    // Flag the highest-engagement followers for the monetization loop (§2.8).
    const topFollowers = perf.comments
      .filter((c) => c.kind === "question" || c.kind === "painpoint")
      .sort((a, b) => b.quality - a.quality)
      .slice(0, 5)
      .map((c) => c.author);

    this.db.logEvent({
      agent: "engagement",
      stationId: station.id,
      msg: `post ${post.id}: replied ${replies.length}, skipped ${skipped}, decision=${decision.action}${escalations.length ? `, ${escalations.length} escalated` : ""}`,
    });

    return { replies, skipped, escalations, decision, topFollowers };
  }

  _reply(persona, comment, rng) {
    if (comment.kind === "question") {
      return pick(rng, ["great q — short answer: yes, start small.", "ooh good one. i'd do step 1 first.", "dropping a full breakdown soon, but tl;dr: try it tonight."]);
    }
    if (comment.kind === "painpoint") {
      return pick(rng, ["been there. the fix is dumber than you think.", "you're not alone — this tripped me up for months.", "this is exactly why i made the video 🙌"]);
    }
    return pick(rng, ["appreciate you 🙏", "thank you!! means a lot.", "🫡"]);
  }

  // still-growing vs flat, using the velocity around the 2h mark.
  _velocityDecision(perf) {
    const s = perf.series;
    const at2 = s[POLICY.ENGAGEMENT_WINDOW_HOURS]?.views ?? 0;
    const at1 = s[POLICY.ENGAGEMENT_WINDOW_HOURS - 1]?.views ?? 0;
    const peakDelta = Math.max(...s.slice(1).map((p, i) => p.views - s[i].views));
    const currentDelta = at2 - at1;
    const ratio = peakDelta > 0 ? currentDelta / peakDelta : 0;
    if (ratio >= POLICY.VELOCITY_FLAT_RATIO) {
      return { action: "keep-replying", ratio: +ratio.toFixed(2) };
    }
    return { action: "stop-reallocate", ratio: +ratio.toFixed(2) };
  }
}
