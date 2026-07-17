# Autonomous Agentic Content System — reference implementation

A runnable, dependency-free implementation of the [blueprint](./BLUEPRINT.md):
an Orchestrator coordinating 11 agents that run each "station" (one niche + one
platform + one persona) through the article's 30-day arc — niche selection →
viral-opener mining → exact-opener remixing → daily posting → 2-hour engagement
window → relative winner detection → doubling down → **delayed** monetization.

## ⚠️ Scope & the honest risk note (blueprint §8)

This repo runs the **entire architecture end-to-end against a deterministic
simulation provider**. It touches **no external service and no social account.**
That is a deliberate choice, not a shortcut:

> The single biggest threat to this design is not technical. Operating hundreds
> of automated accounts sits in direct tension with most platforms' spam and
> inauthentic-behavior policies. — blueprint §8

So everything external lives behind one seam, [`src/core/provider.js`](./src/core/provider.js):
LLM generation, platform search, publishing, metrics, and comments. The shipped
`SimulationProvider` fabricates all of it deterministically. A `LiveProvider`
(not included) would implement the same surface against real APIs — and **only
then** do the multi-account, ToS, and AI-disclosure risks become real. The
Compliance agent, AI-content disclosure, originality ceiling, dedup, and
per-station/per-platform kill switches are **real logic**, active in every run.

Nothing here should be pointed at live platforms without per-network ToS review,
proper AI-content labeling, and per-station volume/behavior kept inside each
platform's published rules.

## Run it

```bash
cd acs
node src/cli.js reset 42        # wipe state (optional seed for reproducibility)
node src/cli.js seed 6 42       # provision 6 stations (Phase 1 MVP scale)
node src/cli.js run 65          # advance 65 sim-days (past the day-60 gate)
node src/cli.js status          # portfolio + KPI summary
node src/server.js              # dashboard at http://localhost:4317
npm test                        # 16 tests over the hard constraints + pipeline
```

State persists in `data/db.json` between commands. The dashboard's **Advance
1 day / +5 days** buttons tick the same store live.

## How the code maps to the blueprint

| Blueprint | Module |
|---|---|
| §2.1 Orchestrator (control plane) | `src/core/orchestrator.js` |
| §1 Station lifecycle state machine | `src/core/stateMachine.js` |
| Hard behavioral rules (no niche switch <30, no sell <60, …) | `src/core/policies.js` |
| §2.2 Niche Intelligence (+ creator verification, balancing) | `src/agents/nicheIntelligence.js` |
| §2.3 Winner Mining + Opener Library + dedup | `src/agents/winnerMining.js` |
| §2.4 Persona & Voice (canon + banned-word filter) | `src/agents/persona.js` |
| §2.5 Script Generation (remix engine + original/experiments) | `src/agents/scriptGeneration.js` |
| §2.6 Production (faceless render + QA gate) | `src/agents/production.js` |
| §2.7 Publishing (3 hashtags, native, no-backfill) | `src/agents/publishing.js` |
| §2.8 Engagement (2h window, velocity decision, safety) | `src/agents/engagement.js` |
| §2.9 Analytics & Winner Detection (relative, small-sample) | `src/agents/analytics.js` |
| §2.10 Monetization (day-60 gate, proposal → human) | `src/agents/monetization.js` |
| §2.11 Compliance & Risk (originality, shadowban, kill switch) | `src/agents/compliance.js` |
| §3 Dashboard (Portfolio / Research / Ops / Station) | `src/server.js` + `public/index.html` |
| §4 Data layer (Opener Library, Persona, Content, Perf, Policy) | `src/core/dataLayer.js` |
| §5 Daily workflow | `Orchestrator.runStationDay()` |

## What each daily tick does (§5)

For every non-killed station, in the article's order:

1. **Night** — Winner Mining refreshes the niche's Opener Library (sources ≥1M
   views); yesterday's winner flags are already recorded.
2. **Early AM** — Script Agent drafts today's post (remix from a proven opener,
   or an original "what surprised me" in the original/growth phases). Persona
   filter + Compliance pre-publish gate.
3. **AM** — Production renders (faceless/TTS/kinetic-text), QA validates
   title/opener verbatim-match + duration + audio; ~5% sampled for HITL.
4. **Optimal window** — Publishing posts natively with a caption + exactly 3
   hashtags, at the station's staggered hour.
5. **Hours 0–2** — Engagement replies to every non-spam comment in the persona's
   voice, flags the top-5 engagers.
6. **Hour 2** — velocity decision: keep replying or stop & reallocate.
7. **Continuous** — metrics ingested; Analytics detects winners *relative to the
   station's own trailing median* and feeds them back to the Opener Library;
   Compliance runs a shadowban sweep; Monetization proposes an offer **only** if
   day ≥ 60 and all trust gates hold.

## The rules that are enforced, not suggested

- **No niche switching before day 30**, **no selling before day 60** — gated in
  `policies.js`, checked by the state machine every day.
- **Copy the opener exactly, remix the body** — title + opener are locked
  verbatim; the body's similarity to the source is capped (`MAX_BODY_SIMILARITY`)
  so output never crosses into reupload territory.
- **Dedup** — no two stations in a niche remix the same source in the same week.
- **1 post/day, never backfill** — a missed day (library exhausted, QA fail,
  publish reject) resets the streak; the system tries again tomorrow.
- **Winners are relative** — a post wins by beating the station's own trailing
  median >2×, so small accounts still produce signal (the "400 vs 150" insight).
- **Every post is AI-labeled**; the kill switch halts a station or platform.

North-star metrics, in the blueprint's priority order: posts shipped → winner
rate → engagement-window compliance → followers/views → revenue after day 60.

## Swapping in a live provider

Implement the `SimulationProvider` surface (`searchTopCreators`, `publish`,
`simulatePost`/metrics fetch, comment fetch, `fillTemplate` → real LLM call) in
a `LiveProvider`, then pass it to `new Orchestrator(db, new LiveProvider())`.
Everything upstream — agents, policies, dashboard — is unchanged. Read §8 first.
