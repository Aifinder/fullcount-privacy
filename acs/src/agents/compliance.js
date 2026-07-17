// §2.11 Compliance & Risk Agent.
// The blueprint's §8 is explicit: this agent is not an add-on, it's the
// difference between a media portfolio and a mass-ban event. It enforces:
//   - originality guard: verbatim copying limited to title + opener; body
//     similarity to any source is scored and capped (§6.3)
//   - AI-content disclosure presence (§6.5)
//   - account health / shadowban detection via reach anomalies (§2.11)
//   - a per-station and per-platform KILL SWITCH
// Anything it fails BLOCKS publishing and routes to the ops queue.

import { POLICY } from "../core/policies.js";
import { jaccardSimilarity, median } from "../core/util.js";

export class ComplianceAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Pre-publish gate on a script. Returns { pass, violations[] }.
  checkScript(station, script) {
    const violations = [];

    // Kill switches.
    if (station.killed) violations.push("station_killed");
    if (this._platformKilled(station.platform)) violations.push(`platform_killed:${station.platform}`);

    // Originality guard (§6.3): compare the REMIXED body against the source
    // opener's material. Title + opener may match verbatim (that's the whole
    // method) but the body may not resemble the source too closely.
    if (script.sourceOpenerId) {
      const opener = this.db.byId("openers", script.sourceOpenerId);
      if (opener) {
        const sim = jaccardSimilarity(script.body, `${opener.title} ${opener.opener}`);
        if (sim > POLICY.MAX_BODY_SIMILARITY_TO_SOURCE) {
          violations.push(`body_too_similar:${sim.toFixed(2)}`);
        }
      }
    }

    // AI-content disclosure must be present (§6.5).
    if (!script.disclosure) violations.push("missing_ai_disclosure");

    const pass = violations.length === 0;
    if (!pass) {
      this.db.logEvent({
        agent: "compliance",
        level: "warn",
        stationId: station.id,
        msg: `blocked script ${script.id}: ${violations.join(", ")}`,
      });
    }
    return { pass, violations };
  }

  // Account-health sweep run after metrics land (§2.11). Sustained reach far
  // below the station's own median trips shadowban suspicion -> amber/red and
  // an ops alert. Does NOT auto-kill; that's a human/kill-switch decision.
  healthSweep(station) {
    const perf = this.db.performanceFor(station.id);
    if (perf.length < 5) return { status: station.status, shadowbanned: false };
    const views = perf.map((p) => p.finalViews);
    const med = median(views);
    const recent = views.slice(-3);
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const ratio = med > 0 ? recentMean / med : 1;
    const suspect = ratio < POLICY.SHADOWBAN_REACH_DROP_RATIO;
    if (suspect && !station.shadowbanned) {
      station.shadowbanned = true;
      this.db.logEvent({
        agent: "compliance",
        level: "alert",
        stationId: station.id,
        msg: `shadowban suspected: recent reach ${(ratio * 100).toFixed(0)}% of median`,
      });
    } else if (!suspect && station.shadowbanned) {
      station.shadowbanned = false;
    }
    return { status: station.status, shadowbanned: station.shadowbanned, ratio };
  }

  // Kill switches (§2.11).
  killStation(station, reason) {
    station.killed = true;
    station.status = "killed";
    this.db.logEvent({ agent: "compliance", level: "alert", stationId: station.id, msg: `KILL SWITCH: ${reason}` });
  }

  killPlatform(platform, reason) {
    let ps = this.db.find("policyStore", (p) => p.platform === platform);
    if (!ps) {
      ps = { platform, killed: false, rules: {} };
      this.db.insert("policyStore", ps);
    }
    ps.killed = true;
    ps.killReason = reason;
    this.db.logEvent({ agent: "compliance", level: "alert", msg: `PLATFORM KILL: ${platform} — ${reason}` });
  }

  _platformKilled(platform) {
    const ps = this.db.find("policyStore", (p) => p.platform === platform);
    return !!(ps && ps.killed);
  }
}
