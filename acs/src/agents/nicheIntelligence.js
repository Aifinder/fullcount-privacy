// §2.2 Niche Intelligence Agent.
// Implements the "3-circle" test at scale for stations with no human operator
// to draw on: demand scoring, competition mapping WITH verification ("check
// the intern's work"), and portfolio balancing across all stations.

import { seededRng } from "../core/util.js";
import * as C from "../core/corpus.js";

export class NicheIntelligenceAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Score every candidate niche for demand + AI adjacency, then pick one that
  // keeps the portfolio diversified (§2.2 portfolio balancing).
  assignNiche(stationSeed, day) {
    const counts = this._nicheCounts();
    const scored = C.NICHES.map((niche) => {
      const rng = seededRng("niche-score", niche.id, stationSeed);
      const demand = niche.demand;
      const cpmScore = Math.min(niche.cpm / 25, 1);
      const aiAdjacency = niche.aiAdjacent ? 0.15 : 0;
      // diversification penalty: the more stations already on this niche, the
      // less attractive it is (avoids over-concentration).
      const concentration = (counts[niche.id] || 0);
      const penalty = concentration * 0.18;
      const score = demand * 0.5 + cpmScore * 0.25 + aiAdjacency + rng() * 0.1 - penalty;
      return { niche, score, concentration };
    }).sort((a, b) => b.score - a.score);

    const chosen = scored[0].niche;

    // Competition mapping + verification (§2.2). The mining provider returns
    // some hallucinated creators; we drop the unverified ones and keep proof
    // that real top creators exist (demand validation).
    const creators = this.provider.searchTopCreators(chosen, day);
    const verified = creators.filter((c) => c.verified);
    const rejected = creators.length - verified.length;

    const brief = this._brief(chosen, verified);

    this.db.logEvent({
      agent: "niche-intelligence",
      msg: `assigned "${chosen.label}" (${verified.length} verified creators, ${rejected} hallucinated dropped)`,
    });

    return {
      nicheId: chosen.id,
      nicheLabel: chosen.label,
      demand: chosen.demand,
      aiAdjacent: chosen.aiAdjacent,
      brief,
      competitors: verified.map((c) => c.handle),
    };
  }

  // "This station teaches [WHO] how to [WHAT]" — also becomes the bio.
  _brief(niche, verified) {
    const who = whoFor(niche.id);
    const what = niche.label;
    return {
      statement: `This station teaches ${who} how to master ${what}.`,
      who,
      what,
      demandEvidence: `${verified.length} verified creators; est CPM $${niche.cpm}; demand ${(niche.demand * 100).toFixed(0)}/100`,
    };
  }

  _nicheCounts() {
    const counts = {};
    for (const s of this.db.all("stations")) {
      if (s.status === "killed") continue;
      counts[s.niche] = (counts[s.niche] || 0) + 1;
    }
    return counts;
  }

  // Portfolio-level guard the orchestrator can call to detect over-concentration.
  concentrationReport() {
    const counts = this._nicheCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(counts)
      .map(([niche, n]) => ({ niche, n, share: n / total }))
      .sort((a, b) => b.share - a.share);
  }
}

function whoFor(nicheId) {
  const map = {
    "ai-productivity": "busy solopreneurs",
    "home-cooking": "tired weeknight cooks",
    "personal-finance": "broke 20-somethings",
    houseplants: "nervous new plant parents",
    "strength-training": "gym beginners",
    "notion-systems": "overwhelmed organizers",
    "indie-hacking": "first-time builders",
    "sleep-health": "chronically tired people",
    watercolor: "absolute beginners",
    "car-detailing": "weekend car owners",
    "resume-career": "career switchers",
    "budget-travel": "broke travelers",
  };
  return map[nicheId] || "beginners";
}
