// Dashboard server (§3). Zero-dependency Node http server. Serves the static
// dashboard and a small read-only JSON API computed from the data store, plus
// a POST /api/tick to advance the simulation from the UI and POST /api/kill
// to exercise the per-station kill switch (§2.11).

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { DataLayer } from "./core/dataLayer.js";
import { Orchestrator } from "./core/orchestrator.js";
import { ComplianceAgent } from "./agents/compliance.js";
import { NicheIntelligenceAgent } from "./agents/nicheIntelligence.js";
import { median } from "./core/util.js";
import { phaseForDay, POLICY } from "./core/policies.js";
import { monetizationEligibility } from "./core/policies.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");
const PORT = process.env.PORT || 4317;

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/state") return json(res, buildState());
    if (url.pathname.startsWith("/api/station/")) return json(res, buildStation(url.pathname.split("/").pop()));
    if (url.pathname === "/api/tick" && req.method === "POST") return json(res, doTick());
    if (url.pathname === "/api/kill" && req.method === "POST") return handleKill(req, res);
    return serveStatic(url.pathname, res);
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e && e.stack || e) }));
  }
});

function json(res, obj) {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  const file = pathname === "/" ? "/index.html" : pathname;
  const full = join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !existsSync(full)) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "content-type": MIME[extname(full)] || "text/plain" });
  res.end(readFileSync(full));
}

function doTick() {
  const db = new DataLayer().load();
  const orch = new Orchestrator(db);
  const r = orch.tick();
  db.save();
  return r;
}

function handleKill(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { stationId } = JSON.parse(body || "{}");
    const db = new DataLayer().load();
    const station = db.station(stationId);
    if (!station) return json(res, { ok: false, error: "no such station" });
    new ComplianceAgent(db).killStation(station, "manual kill switch (dashboard)");
    db.save();
    json(res, { ok: true, stationId });
  });
}

// ---- API payloads ----
function buildState() {
  const db = new DataLayer().load();
  const stations = db.all("stations");
  const totalPosts = stations.reduce((a, s) => a + s.postsShipped, 0);
  const totalWinners = stations.reduce((a, s) => a + s.winnerCount, 0);
  const totalFollowers = stations.reduce((a, s) => a + s.followers, 0);
  const perf = db.all("performance");
  const engCompliant = perf.length
    ? perf.filter((p) => {
        const post = db.byId("content", p.postId);
        return post && post.engagement; // engagement ran within window
      }).length / perf.length
    : 0;

  const niche = new NicheIntelligenceAgent(db);

  return {
    meta: {
      clock: db.clock,
      seed: db.meta.seed,
      provider: "simulation",
      stationCount: stations.length,
    },
    kpis: {
      postsShipped: totalPosts,
      avgPostsPerStationPerDay: db.clock ? +(totalPosts / stations.length / db.clock).toFixed(2) : 0,
      winners: totalWinners,
      winnerRate: totalPosts ? +((totalWinners / totalPosts) * 100).toFixed(1) : 0,
      engagementCompliance: +(engCompliant * 100).toFixed(0),
      followers: totalFollowers,
      monetizationEligible: stations.filter((s) => s.offerProposalId).length,
    },
    stations: stations.map((s) => stationSummary(db, s)),
    research: {
      concentration: niche.concentrationReport(),
      openersByNiche: openersByNiche(db),
      validatedPatterns: validatedPatterns(db),
    },
    ops: {
      events: db.all("events").slice(-120).reverse(),
      failureQueue: db.all("events").filter((e) => e.level === "warn").slice(-30).reverse(),
      hitlInbox: db.all("events").filter((e) => e.level === "hitl").slice(-30).reverse(),
      compliance: db.all("events").filter((e) => e.level === "alert").slice(-30).reverse(),
    },
    alerts: buildAlerts(db, stations),
  };
}

function stationSummary(db, s) {
  const perf = db.performanceFor(s.id);
  const recent7 = perf.slice(-7).reduce((a, p) => a + p.finalViews, 0);
  const gate = monetizationEligibility(s);
  return {
    id: s.id,
    name: s.name,
    niche: s.niche,
    platform: s.platform,
    phase: phaseForDay(s.currentDay),
    day: s.currentDay,
    postsShipped: s.postsShipped,
    streak: s.streak,
    followers: s.followers,
    winnerCount: s.winnerCount,
    winnerRate: s.postsShipped ? +((s.winnerCount / s.postsShipped) * 100).toFixed(1) : 0,
    view7d: recent7,
    status: s.status,
    shadowbanned: s.shadowbanned,
    monetizationReady: gate.eligible,
    monetizationBlockers: gate.reasons,
    escalated: s.escalated,
  };
}

function openersByNiche(db) {
  const map = {};
  for (const o of db.all("openers")) {
    (map[o.nicheId] ||= []).push(o);
  }
  return Object.entries(map).map(([nicheId, list]) => ({
    niche: nicheId,
    count: list.length,
    top: list.sort((a, b) => b.score - a.score).slice(0, 5).map((o) => ({
      opener: o.opener,
      title: o.title,
      views: o.views,
      score: o.score,
      usedBy: o.usedBy.length,
      wins: o.internalPerf.filter((p) => p.winner).length,
    })),
  }));
}

function validatedPatterns(db) {
  return db.all("openers")
    .filter((o) => o.internalPerf.some((p) => p.winner))
    .sort((a, b) => b.internalPerf.filter((p) => p.winner).length - a.internalPerf.filter((p) => p.winner).length)
    .slice(0, 10)
    .map((o) => ({ opener: o.opener, niche: o.nicheId, wins: o.internalPerf.filter((p) => p.winner).length, usedBy: o.usedBy.length }));
}

function buildAlerts(db, stations) {
  const alerts = [];
  for (const s of stations) {
    if (s.status === "red") alerts.push({ level: "red", station: s.id, msg: s.shadowbanned ? "shadowban suspected" : "repeated publish failures" });
    if (s.streak === 0 && s.currentDay > 8 && !s.killed) alerts.push({ level: "amber", station: s.id, msg: "missed post" });
    if (s.offerProposalId) alerts.push({ level: "info", station: s.id, msg: "eligible for monetization review" });
    if (s.escalated) alerts.push({ level: "amber", station: s.id, msg: "no winner by post 20 — fidelity escalated" });
  }
  // outlier winners today
  const today = db.clock;
  for (const p of db.all("performance").filter((p) => p.day === today && p.winner)) {
    alerts.push({ level: "win", station: p.stationId, msg: `winner: ${p.finalViews.toLocaleString()} views` });
  }
  return alerts.slice(-40);
}

function buildStation(id) {
  const db = new DataLayer().load();
  const s = db.station(id);
  if (!s) return { error: "not found" };
  const persona = db.find("personas", (p) => p.stationId === id);
  const perf = db.performanceFor(id);
  const posts = db.postsFor(id).slice(-30).reverse();
  const leaderboard = perf.slice().sort((a, b) => b.finalViews - a.finalViews).slice(0, 8).map((p) => ({
    postId: p.postId, day: p.day, views: p.finalViews, winner: p.winner,
    title: db.byId("content", p.postId)?.title,
  }));
  const calendar = posts.map((p) => ({
    day: p.day, title: p.title, opener: p.openerLine, hashtags: p.hashtags,
    disclosure: p.disclosure, engagement: p.engagement,
    views: perf.find((x) => x.postId === p.id)?.finalViews ?? 0,
    winner: perf.find((x) => x.postId === p.id)?.winner ?? false,
    fromSource: p.sourceOpenerId,
  }));
  const offer = db.find("content", () => false); // offers logged as events; expose readiness
  return {
    station: stationSummary(db, s),
    persona,
    brief: s.brief,
    calendar,
    leaderboard,
    openerHitsUsed: db.all("openers").filter((o) => o.usedBy.some((u) => u.stationId === id)).length,
    engagementLog: db.all("events").filter((e) => e.stationId === id && e.agent === "engagement").slice(-15).reverse(),
    monetization: monetizationEligibility(s),
  };
}

server.listen(PORT, () => {
  console.log(`ACS dashboard on http://localhost:${PORT}`);
});
