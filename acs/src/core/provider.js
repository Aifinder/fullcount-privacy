// Provider seam. Everything external to the system lives behind this
// interface: the LLM used for generation, and the social-platform APIs used
// for winner mining, publishing, metrics, and comments.
//
// The SimulationProvider below is fully deterministic and touches NO external
// service, so the whole pipeline runs offline and reproducibly. A
// LiveProvider (not shipped here) would implement the same surface against
// real APIs — and only then do the §8 platform-ToS, multi-account, and
// AI-disclosure risks become real. Keeping the seam explicit is what makes
// "swap in production carefully" a one-file change rather than a rewrite.

import {
  seededRng, pick, pickN, randInt, clamp, shortId,
} from "./util.js";
import * as C from "./corpus.js";

export class SimulationProvider {
  constructor() {
    this.name = "simulation";
    this.live = false;
  }

  // ---- LLM surface (§2.2, §2.4, §2.5) ----
  // We don't call a real model; we compose deterministic synthetic text so
  // the pipeline shape is exercised. Swap for a real completion call.
  fillTemplate(template, niche, rng) {
    const things = C.THING_BY_NICHE[niche.id] || ["this"];
    return template
      .replace(/\{THING\}/g, pick(rng, things))
      .replace(/\{NUMBER\}/g, String(randInt(rng, 3, 9)))
      .replace(/\{OUTCOME\}/g, pick(rng, C.OUTCOMES))
      .replace(/\{STAKE\}/g, pick(rng, C.STAKES))
      .replace(/\{PAIN\}/g, pick(rng, C.PAINS))
      .replace(/\{ADVERB\}/g, pick(rng, C.ADVERBS));
  }

  // ---- Platform: winner mining (§2.3) ----
  // Return top creators for a niche, each with their most-viewed videos.
  searchTopCreators(niche, day) {
    const rng = seededRng("creators", niche.id, day);
    const n = randInt(rng, 5, 10); // article: 5-10 top creators per niche
    const creators = [];
    for (let i = 0; i < n; i++) {
      const name = `@${pick(rng, C.FIRST_NAMES).toLowerCase()}_${niche.id.split("-")[0]}${randInt(rng, 1, 99)}`;
      // "verify they actually exist" (§2.2): the sim marks a small fraction as
      // hallucinated so the niche agent's verification step has something to
      // catch. Real impl checks the handle against the platform API.
      const verified = rng() > 0.12;
      creators.push({
        handle: name,
        verified,
        followers: randInt(rng, 40_000, 4_000_000),
        videos: this._videosFor(niche, name, rng),
      });
    }
    return creators;
  }

  _videosFor(niche, creatorHandle, rng) {
    const n = randInt(rng, 3, 6);
    const vids = [];
    for (let i = 0; i < n; i++) {
      const vr = seededRng("vid", creatorHandle, i);
      const openerTpl = pick(vr, C.OPENER_TEMPLATES);
      const titleTpl = pick(vr, C.TITLE_TEMPLATES);
      vids.push({
        id: shortId("src", vr),
        creator: creatorHandle,
        title: this.fillTemplate(titleTpl, niche, vr),
        opener: this.fillTemplate(openerTpl, niche, vr),
        views: Math.floor(200_000 + vr() * vr() * 12_000_000), // long tail
        ageDays: randInt(vr, 1, 120),
        format: {
          pacing: pick(vr, ["fast-cut", "single-take", "kinetic-text"]),
          style: pick(vr, ["bold-caption", "face-cam", "screen-record", "b-roll"]),
          durationSec: randInt(vr, 12, 45),
        },
      });
    }
    return vids;
  }

  // ---- Platform: publishing (§2.7) ----
  // Simulate an upload. Occasionally the platform rejects (rate limit / policy)
  // so the failure-recovery path (§6.10) is exercised.
  publish(station, asset, day) {
    const rng = seededRng("publish", station.id, day);
    const roll = rng();
    if (roll < 0.04) {
      return { ok: false, reason: pick(rng, ["rate_limited", "upload_rejected", "duplicate_content_flag"]) };
    }
    return { ok: true, externalId: shortId("ext", rng), postedAtHour: station.optimalHour };
  }

  // ---- Platform: metrics ingestion (§2.9) ----
  // Produce a realistic view/comment trajectory for a post. Quality of the
  // opener + persona fit + follower base drive the ceiling; noise decides the
  // outlier. Returns cumulative views at each hour mark 0..24 and a comment set.
  simulatePost(station, post, sourceOpenerScore) {
    const rng = seededRng("perf", post.id);
    // Baseline organic reach exists even at zero followers (the algorithm
    // shows new posts to a small test audience); followers add on top.
    const base = clamp(180 + station.followers * 0.25, 150, 500_000);
    const openerBoost = 0.6 + sourceOpenerScore * 1.8; // strong opener => more reach
    const luck = 0.4 + rng() * rng() * 6; // heavy-tailed: rare big hits
    const health = station.shadowbanned ? 0.2 : 1;
    const ceiling = Math.floor(base * openerBoost * luck * health);

    // cumulative views over 24h using a saturating curve
    const series = [];
    for (let h = 0; h <= 24; h++) {
      const frac = 1 - Math.exp(-h / 5.5);
      series.push({ hour: h, views: Math.floor(ceiling * frac) });
    }
    const finalViews = series[series.length - 1].views;

    // comments scale with views; generate a realistic mix
    const nComments = clamp(Math.floor(finalViews / 300), 0, 60);
    const comments = [];
    const things = C.THING_BY_NICHE[station.niche] || ["this"];
    for (let i = 0; i < nComments; i++) {
      const cr = seededRng("cmt", post.id, i);
      const kind = weightedKind(cr);
      let text = pick(cr, C.COMMENT_BANK[kind]).replace(/\{THING\}/g, pick(cr, things));
      comments.push({
        id: `${post.id}-c${i}`,
        kind,
        text,
        author: `@fan${randInt(cr, 1000, 99999)}`,
        atHour: Math.floor(cr() * 24),
        quality: kind === "question" || kind === "painpoint" ? 0.6 + cr() * 0.4 : (kind === "praise" ? 0.3 + cr() * 0.3 : 0.05),
      });
    }
    return { series, finalViews, comments };
  }

  // ---- Platform: account health (§2.11) ----
  checkAccountHealth(station, recentReach, medianReach) {
    if (medianReach <= 0) return { shadowbanned: false, ratio: 1 };
    const ratio = recentReach / medianReach;
    return { shadowbanned: false, ratio }; // detection logic lives in compliance agent
  }
}

function weightedKind(rng) {
  const r = rng();
  if (r < 0.42) return "praise";
  if (r < 0.66) return "question";
  if (r < 0.82) return "painpoint";
  if (r < 0.93) return "spam";
  return "abuse";
}
