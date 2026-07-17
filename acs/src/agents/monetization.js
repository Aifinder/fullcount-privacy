// §2.10 Monetization Agent (Day 60+ gate).
// Mines comments/DMs for repeated questions and pain points (the automated
// "your comments tell you what to sell"), scores the three monetization paths
// against audience signals, and HARD-GATES any offer behind day 60 + trust
// thresholds. Output is a single proposal per station for HUMAN approval —
// nothing is ever sold autonomously.

import { monetizationEligibility } from "../core/policies.js";

export class MonetizationAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Aggregate demand signals from the station's comment corpus.
  demandSignals(station) {
    const perf = this.db.performanceFor(station.id);
    const buckets = { question: [], painpoint: [] };
    for (const p of perf) {
      for (const c of p.comments) {
        if (buckets[c.kind]) buckets[c.kind].push(c.text);
      }
    }
    const freq = {};
    for (const t of [...buckets.question, ...buckets.painpoint]) {
      freq[t] = (freq[t] || 0) + 1;
    }
    const top = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([text, n]) => ({ text, n }));
    return { questions: buckets.question.length, painpoints: buckets.painpoint.length, top };
  }

  // Propose an offer IF eligible. Returns { eligible, reasons } when gated.
  proposeOffer(station) {
    const gate = monetizationEligibility(station);
    if (!gate.eligible) {
      this.db.logEvent({
        agent: "monetization",
        stationId: station.id,
        msg: `offer gated: ${gate.reasons.join("; ")}`,
      });
      return { eligible: false, reasons: gate.reasons };
    }

    const signals = this.demandSignals(station);
    // Score the three paths (§2.10) from audience signals.
    const paths = [
      { type: "1-on-1 service", score: signals.painpoints * 1.5 + station.repeatEngagers },
      { type: "guide / community", score: signals.questions * 1.2 + station.followers / 100 },
      { type: "product", score: station.followers / 50 + signals.top.length * 3 },
    ].sort((a, b) => b.score - a.score);

    const proposal = {
      id: `offer_${station.id}_${station.currentDay}`,
      stationId: station.id,
      day: station.currentDay,
      recommendedPath: paths[0].type,
      rationale: `top asks: ${signals.top.map((t) => `"${t.text}" (${t.n})`).join(", ") || "n/a"}`,
      status: "awaiting_human_approval", // never auto-sold
      paths,
    };
    this.db.logEvent({
      agent: "monetization",
      level: "action",
      stationId: station.id,
      msg: `offer proposal ready (${proposal.recommendedPath}) — awaiting human approval`,
    });
    return { eligible: true, proposal };
  }
}
