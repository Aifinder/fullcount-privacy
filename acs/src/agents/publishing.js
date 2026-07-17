// §2.7 Publishing Agent.
// Multi-platform distribution behind the provider seam. Platform-specific
// packaging: caption + exactly 3 broad niche hashtags, native upload
// preference. Enforces 1 post/day and the "miss a day -> post tomorrow, never
// backfill-spam" recovery rule. Posting times are staggered per station to
// avoid burst patterns across the portfolio.

import { POLICY } from "../core/policies.js";
import { seededRng, pick } from "../core/util.js";
import * as C from "../core/corpus.js";

export class PublishingAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  hashtags(station) {
    const rng = seededRng("tags", station.id, station.niche);
    const base = station.niche.split("-");
    const pool = [
      station.niche.replace(/-/g, ""),
      base[0],
      base[base.length - 1],
      "howto",
      "tips",
      "learnontiktok",
    ];
    // exactly 3 broad hashtags (§2.7)
    const tags = [];
    while (tags.length < POLICY.HASHTAGS_PER_POST && pool.length) {
      const t = pick(rng, pool);
      if (!tags.includes(t)) tags.push(t);
      pool.splice(pool.indexOf(t), 1);
    }
    return tags.slice(0, POLICY.HASHTAGS_PER_POST).map((t) => `#${t}`);
  }

  caption(station, persona, script) {
    const rng = seededRng("caption", script.id);
    return `${script.title} — ${pick(rng, ["save this", "try it today", "you'll want this later"])}`;
  }

  // Publish a rendered asset. Returns the post record or a failure that the
  // orchestrator routes to failure-recovery (§6.10).
  publish(station, persona, script, asset, day) {
    const result = this.provider.publish(station, asset, day);
    if (!result.ok) {
      this.db.logEvent({
        agent: "publishing",
        level: "warn",
        stationId: station.id,
        msg: `publish failed (${result.reason}); no backfill — will try tomorrow`,
      });
      return { ok: false, reason: result.reason };
    }
    const post = {
      id: `post_${asset.scriptId}`,
      kind: "post",
      stationId: station.id,
      scriptId: script.id,
      assetId: asset.id,
      sourceOpenerId: script.sourceOpenerId,
      externalId: result.externalId,
      day,
      hour: result.postedAtHour,
      platform: station.platform,
      caption: this.caption(station, persona, script),
      hashtags: this.hashtags(station),
      title: script.title,
      openerLine: script.openerLine,
      disclosure: asset.disclosureLabel,
      native: true, // native uploads outperform third-party pushes (§2.7)
    };
    this.db.insert("content", post);
    return { ok: true, post };
  }
}
