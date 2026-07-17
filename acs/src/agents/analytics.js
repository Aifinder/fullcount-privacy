// §2.9 Analytics & Winner Detection Agent.
// Relative benchmarking, not absolute: a post is a winner if it beats the
// station's OWN running median by >2x (the "400 vs 150 views is signal"
// insight for small accounts). Attributes outliers to opener/title/format/time,
// feeds winners back to the Opener Library as internally-validated patterns,
// and escalates when no winner has emerged by ~post 20.

import { POLICY } from "../core/policies.js";
import { median } from "../core/util.js";

export class AnalyticsAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Record a post's performance and decide winner status relative to the
  // station's history so far.
  record(station, post, perf) {
    const priorViews = this.db
      .performanceFor(station.id)
      .map((p) => p.finalViews);
    // Small-sample-appropriate baseline (§6.8): benchmark against a TRAILING
    // window, not all-time history. This keeps the bar tracking the station's
    // current level so winners stay meaningful as the account grows, instead
    // of every early post clearing a permanently-low median.
    const WINDOW = 15;
    const window = priorViews.slice(-WINDOW);
    const stationMedian = median(window);
    const isWinner =
      window.length >= 6 && // need a real baseline before calling winners
      stationMedian > 0 &&
      perf.finalViews >= stationMedian * POLICY.WINNER_MEDIAN_MULTIPLE;

    const row = {
      postId: post.id,
      stationId: station.id,
      day: post.day,
      sourceOpenerId: post.sourceOpenerId,
      finalViews: perf.finalViews,
      series: perf.series,
      comments: perf.comments,
      commentCount: perf.comments.length,
      meanCommentQuality: perf.comments.length
        ? perf.comments.reduce((a, c) => a + c.quality, 0) / perf.comments.length
        : 0,
      stationMedianAtPost: stationMedian,
      winner: isWinner,
      postIndex: priorViews.length + 1,
    };
    this.db.insert("performance", row);

    // Feed winners back to the Opener Library (§2.9 -> §2.3 loop).
    if (isWinner && post.sourceOpenerId) {
      const opener = this.db.byId("openers", post.sourceOpenerId);
      if (opener) {
        opener.internalPerf.push({ stationId: station.id, day: post.day, winner: true, views: perf.finalViews });
      }
    }

    if (isWinner) {
      this.db.logEvent({
        agent: "analytics",
        level: "win",
        stationId: station.id,
        msg: `WINNER: ${post.id} ${perf.finalViews.toLocaleString()} views vs median ${Math.round(stationMedian).toLocaleString()} (${(perf.finalViews / stationMedian).toFixed(1)}x)`,
      });
    }
    return row;
  }

  // Escalation check (§2.9): if no winner by ~post 20, tighten opener fidelity
  // and raise remix volume from higher-view sources.
  needsEscalation(station) {
    const perf = this.db.performanceFor(station.id);
    if (perf.length < POLICY.WINNER_ESCALATION_POST) return false;
    return !perf.some((p) => p.winner);
  }

  // Attribution rollup for the dashboard research view (§2.9 / §3).
  attribution(station) {
    const perf = this.db.performanceFor(station.id);
    const byHour = {};
    const byFormatSource = {};
    for (const p of perf) {
      const post = this.db.byId("content", p.postId);
      if (!post) continue;
      byHour[post.hour] = byHour[post.hour] || { n: 0, views: 0 };
      byHour[post.hour].n++;
      byHour[post.hour].views += p.finalViews;
    }
    return { byHour };
  }
}
