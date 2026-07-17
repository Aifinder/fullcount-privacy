// §2.1 Orchestrator (Control Plane).
// Owns each station's state machine and daily task queue, sequences the agent
// runs in the article's order (§5 daily workflow), enforces global policy as
// hard constraints, and handles failure escalation + HITL sampling. This is
// the only module that mutates station state during a day tick.

import { DataLayer } from "./dataLayer.js";
import { SimulationProvider } from "./provider.js";
import { POLICY } from "./policies.js";
import { seededRng, shortId, clamp } from "./util.js";
import * as SM from "./stateMachine.js";

import { NicheIntelligenceAgent } from "../agents/nicheIntelligence.js";
import { WinnerMiningAgent } from "../agents/winnerMining.js";
import { PersonaAgent } from "../agents/persona.js";
import { ScriptGenerationAgent } from "../agents/scriptGeneration.js";
import { ProductionAgent } from "../agents/production.js";
import { PublishingAgent } from "../agents/publishing.js";
import { EngagementAgent } from "../agents/engagement.js";
import { AnalyticsAgent } from "../agents/analytics.js";
import { MonetizationAgent } from "../agents/monetization.js";
import { ComplianceAgent } from "../agents/compliance.js";

const PLATFORMS = [
  { platform: "tiktok", kind: "short", pipeline: "faceless" },
  { platform: "reels", kind: "short", pipeline: "faceless" },
  { platform: "shorts", kind: "short", pipeline: "faceless" },
  { platform: "linkedin", kind: "text", pipeline: "text" },
  { platform: "threads", kind: "text", pipeline: "text" },
];

// Sampled human QA rate (§5 step 3 / §6.6). A slice of output is flagged for
// human spot-check; the rest ships autonomously.
const HITL_SAMPLE_RATE = 0.05;

export class Orchestrator {
  constructor(db = new DataLayer().load(), provider = new SimulationProvider()) {
    this.db = db;
    this.provider = provider;
    this.niche = new NicheIntelligenceAgent(db, provider);
    this.mining = new WinnerMiningAgent(db, provider);
    this.persona = new PersonaAgent(db, provider);
    this.script = new ScriptGenerationAgent(db, provider);
    this.production = new ProductionAgent(db, provider);
    this.publishing = new PublishingAgent(db, provider);
    this.engagement = new EngagementAgent(db, provider);
    this.analytics = new AnalyticsAgent(db, provider);
    this.monetization = new MonetizationAgent(db, provider);
    this.compliance = new ComplianceAgent(db, provider);
  }

  // ---- provisioning ----
  createStation(index) {
    const rng = seededRng("station", String(index), String(this.db.meta?.seed ?? 0));
    const id = shortId("stn", rng);
    const plat = PLATFORMS[index % PLATFORMS.length];
    const station = {
      id,
      name: `Station ${index + 1}`,
      niche: null,
      platform: plat.platform,
      platformKind: plat.kind,
      pipeline: plat.pipeline,
      currentDay: 0,
      status: "green",
      killed: false,
      shadowbanned: false,
      personaId: null,
      optimalHour: 6 + (index % 14), // staggered posting time (§2.7)
      // running counters
      postsShipped: 0,
      streak: 0,
      lastPostDay: -1,
      followers: 0,
      winnerCount: 0,
      repeatEngagers: 0,
      meanCommentQuality: 0,
      topFollowers: [],
      hitlFlags: 0,
      failedPublishes: 0,
      escalated: false,
      offerProposalId: null,
    };
    this.db.insert("stations", station);
    this.db.logEvent({ agent: "orchestrator", stationId: id, msg: `provisioned on ${plat.platform} (${plat.pipeline})` });
    return station;
  }

  // ---- one simulated day for ALL stations ----
  tick() {
    this.db.clock += 1;
    const day = this.db.clock;
    let posted = 0;
    for (const station of this.db.all("stations")) {
      if (station.killed) continue;
      this.runStationDay(station, day);
      if (station.lastPostDay === day) posted++;
    }
    this.db.logEvent({ agent: "orchestrator", msg: `day ${day} complete — ${posted} stations posted` });
    return { day, posted };
  }

  // ---- the §5 daily workflow, per station ----
  runStationDay(station, day) {
    // The station's own clock advances with the global clock.
    station.currentDay = day;
    const caps = SM.capabilities(station);

    // Bootstrap (days 1-3): select + validate niche; seed persona at day 3.
    if (caps.phase === "bootstrap") {
      if (!station.niche) {
        const brief = this.niche.assignNiche(station.id, day);
        station.niche = brief.nicheId;
        station.brief = brief;
      }
      if (day >= 3 && !station.personaId) {
        const persona = this.persona.create(station, station.brief.brief);
        station.personaId = persona.id;
      }
      return; // no posting during bootstrap
    }

    // Research (days 4-7): seed the opener library nightly; ensure persona.
    if (caps.phase === "research") {
      this.mining.refresh(station.niche, day);
      if (!station.personaId) {
        const persona = this.persona.create(station, station.brief.brief);
        station.personaId = persona.id;
      }
      return; // still no posting — library must fill first
    }

    // From remix phase on: full daily pipeline.
    // 1. NIGHT — refresh mining + winner flags already recorded from yesterday.
    this.mining.refresh(station.niche, day);

    if (!caps.canPost) return;

    const persona = this.persona.get(station.id);

    // 2. EARLY AM — draft today's post per lifecycle phase.
    const draft = this._draft(station, persona, day, caps);
    if (!draft) {
      // Library exhausted for this station/week — miss the day, no backfill.
      station.streak = 0;
      this.db.logEvent({ agent: "orchestrator", level: "warn", stationId: station.id, msg: "no eligible opener; skipping day (no backfill)" });
      return;
    }

    // persona filter (§2.4) — reject if it says a word the persona never would.
    const pf = this.persona.filter(persona, `${draft.openerLine} ${draft.body}`);
    if (!pf.pass) {
      // one rewrite attempt: strip offending words
      for (const w of pf.offending) {
        draft.body = draft.body.replace(new RegExp(w, "gi"), "");
      }
    }

    // compliance pre-publish gate (§2.11).
    const cc = this.compliance.checkScript(station, draft);
    if (!cc.pass) {
      station.streak = 0;
      return; // blocked -> ops failure queue via the logged event
    }
    this.db.insert("content", draft);

    // 3. AM — production render + QA; sampled HITL spot-check.
    const asset = this.production.render(station, persona, draft);
    if (!asset.qa.pass) {
      station.streak = 0;
      this.db.logEvent({ agent: "orchestrator", level: "warn", stationId: station.id, msg: `QA failed (${asset.qa.issues.join(",")}); not publishing` });
      return;
    }
    const rng = seededRng("hitl", draft.id);
    if (rng() < HITL_SAMPLE_RATE) {
      station.hitlFlags++;
      this.db.logEvent({ agent: "orchestrator", level: "hitl", stationId: station.id, msg: `post ${draft.id} sampled for human QA` });
    }

    // 4. OPTIMAL WINDOW — publish natively with caption + 3 hashtags.
    const pub = this.publishing.publish(station, persona, draft, asset, day);
    if (!pub.ok) {
      station.failedPublishes++;
      station.streak = 0; // missed day; recovery = try tomorrow, never backfill
      return;
    }
    const post = pub.post;
    station.postsShipped++; // THE primary KPI (§7)
    station.streak = station.lastPostDay === day - 1 ? station.streak + 1 : 1;
    station.lastPostDay = day;

    // metrics ingestion — simulate the 24h trajectory.
    const opener = post.sourceOpenerId ? this.db.byId("openers", post.sourceOpenerId) : null;
    const openerScore = opener ? opener.score : (draft.sourceScore ?? 0.5);
    const perf = this.provider.simulatePost(station, post, openerScore);

    // 5-6. ENGAGEMENT — reply in-window, then 2h velocity decision.
    const eng = this.engagement.run(station, persona, post, perf);
    post.engagement = { replies: eng.replies.length, decision: eng.decision.action };

    // 7. ANALYTICS — record + winner detection (relative to station median).
    const rec = this.analytics.record(station, post, perf);
    if (rec.winner) station.winnerCount++;

    // roll station counters forward
    this._updateCounters(station, perf, eng, rec.winner);

    // compliance health sweep (shadowban detection) + escalation check.
    this.compliance.healthSweep(station);
    if (this.analytics.needsEscalation(station) && !station.escalated) {
      station.escalated = true;
      this.db.logEvent({ agent: "analytics", level: "action", stationId: station.id, msg: "no winner by post 20 — escalating remix fidelity + higher-view sources" });
    }

    // monetization gate check (only ever proposes; never sells) (§2.10).
    if (caps.canSell && !station.offerProposalId) {
      const res = this.monetization.proposeOffer(station);
      if (res.eligible) station.offerProposalId = res.proposal.id;
    }

    this._refreshStatus(station);
  }

  _draft(station, persona, day, caps) {
    const tighten = station.escalated; // §2.9 escalation tightens fidelity
    if (caps.contentMode === "remix" || (caps.contentMode === "remix-or-original")) {
      const opener = this.mining.pickForStation(station, day);
      if (opener) return this.script.remix(station, persona, opener, day, { tightenFidelity: tighten });
      // fall through to original if library exhausted
    }
    if (caps.contentMode === "original" || caps.contentMode === "remix-or-original") {
      const experiments = this.script.weeklyExperiments(station, day);
      const exp = experiments[day % experiments.length];
      return this.script.original(station, persona, exp, day);
    }
    return null;
  }

  _updateCounters(station, perf, eng, winner) {
    // follower growth loosely tracks views + engagement quality; winners spike
    // it (the article's "double down on winners" payoff).
    const gain = clamp(
      Math.floor(perf.finalViews * 0.03 + eng.replies.length * 3 + (winner ? 150 : 0)),
      0,
      40_000,
    );
    station.followers += gain;
    // repeat engagers: union of flagged top followers over time.
    const set = new Set(station.topFollowers);
    for (const f of eng.topFollowers) set.add(f);
    station.topFollowers = [...set].slice(-200);
    station.repeatEngagers = station.topFollowers.length;
    // running mean comment quality across all posts.
    const all = this.db.performanceFor(station.id);
    const q = all.map((p) => p.meanCommentQuality).filter((n) => n > 0);
    station.meanCommentQuality = q.length ? q.reduce((a, b) => a + b, 0) / q.length : 0;
  }

  _refreshStatus(station) {
    if (station.killed) { station.status = "killed"; return; }
    const perf = this.db.performanceFor(station.id);
    const recentMisses = station.streak === 0;
    if (station.shadowbanned || station.failedPublishes > 3) station.status = "red";
    else if (recentMisses || (perf.length >= 20 && station.winnerCount === 0)) station.status = "amber";
    else station.status = "green";
  }
}
