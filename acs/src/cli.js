#!/usr/bin/env node
// CLI for the Autonomous Agentic Content System reference implementation.
//
//   node src/cli.js reset [seed]     wipe the data store
//   node src/cli.js seed [N] [seed]  provision N stations (default 5, Phase 1)
//   node src/cli.js tick             advance the whole portfolio one day
//   node src/cli.js run [days]       advance N days (default 65 => past monetization gate)
//   node src/cli.js status           print portfolio + KPI summary
//
// State persists in data/db.json between commands. `serve` (server.js) reads
// the same store to render the dashboard.

import { DataLayer } from "./core/dataLayer.js";
import { Orchestrator } from "./core/orchestrator.js";
import { median } from "./core/util.js";

const [cmd, ...rest] = process.argv.slice(2);

function withDb(fn) {
  const db = new DataLayer().load();
  const out = fn(db);
  db.save();
  return out;
}

switch (cmd) {
  case "reset": {
    const seed = rest[0] ? Number(rest[0]) : Date.now();
    const db = new DataLayer().reset(seed).save();
    console.log(`reset. seed=${db.meta.seed}`);
    break;
  }
  case "seed": {
    const n = rest[0] ? Number(rest[0]) : 5;
    const seed = rest[1] ? Number(rest[1]) : Date.now();
    withDb((db) => {
      if (!db.meta.createdAt) db.reset(seed);
      const orch = new Orchestrator(db);
      for (let i = 0; i < n; i++) orch.createStation(db.all("stations").length);
      console.log(`seeded ${n} stations (total ${db.all("stations").length}). seed=${db.meta.seed}`);
    });
    break;
  }
  case "tick": {
    withDb((db) => {
      const orch = new Orchestrator(db);
      const r = orch.tick();
      console.log(`day ${r.day}: ${r.posted} stations posted`);
    });
    break;
  }
  case "run": {
    const days = rest[0] ? Number(rest[0]) : 65;
    withDb((db) => {
      const orch = new Orchestrator(db);
      for (let i = 0; i < days; i++) orch.tick();
      console.log(`ran ${days} days. clock=${db.clock}`);
      printStatus(db);
    });
    break;
  }
  case "status": {
    const db = new DataLayer().load();
    printStatus(db);
    break;
  }
  default:
    console.log("usage: reset [seed] | seed [N] [seed] | tick | run [days] | status");
}

function printStatus(db) {
  const stations = db.all("stations");
  if (!stations.length) {
    console.log("no stations. run: node src/cli.js seed 5");
    return;
  }
  console.log(`\n=== Portfolio (day ${db.clock}) ===`);
  const totalPosts = stations.reduce((a, s) => a + s.postsShipped, 0);
  const totalWinners = stations.reduce((a, s) => a + s.winnerCount, 0);
  const eligible = stations.filter((s) => s.offerProposalId).length;
  console.log(
    `stations=${stations.length}  posts shipped=${totalPosts}  winners=${totalWinners}  ` +
    `winner rate=${totalPosts ? ((totalWinners / totalPosts) * 100).toFixed(1) : "0"}%  ` +
    `monetization-eligible=${eligible}`,
  );
  console.log("");
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("station", 12) + pad("niche", 20) + pad("plat", 9) + pad("phase", 13) + pad("posts", 7) + pad("streak", 7) + pad("follows", 9) + pad("wins", 6) + "status");
  for (const s of stations) {
    const phase = phaseName(s.currentDay);
    console.log(
      pad(s.id, 12) + pad((s.niche || "-").slice(0, 18), 20) + pad(s.platform, 9) +
      pad(phase, 13) + pad(s.postsShipped, 7) + pad(s.streak, 7) +
      pad(s.followers.toLocaleString(), 9) + pad(s.winnerCount, 6) + s.status,
    );
  }
  console.log("");
}

function phaseName(day) {
  if (day <= 3) return "bootstrap";
  if (day <= 7) return "research";
  if (day <= 24) return "remix";
  if (day <= 29) return "original";
  if (day <= 59) return "growth";
  return "monetization";
}
