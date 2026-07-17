// Station lifecycle state machine (§1). The article's 30-day solo arc becomes
// a per-station state machine that hundreds of stations run in parallel. This
// module owns ONLY the phase logic and what each phase permits; the
// orchestrator drives it and the agents do the work.

import { phaseForDay, POLICY } from "./policies.js";

// What kind of content the script agent should produce in each phase.
const PHASE_CONTENT = {
  bootstrap: null, // no posting yet — niche + validation
  research: null, // platform chosen, library seeded, persona configured
  remix: "remix", // ~17 posts remixed from proven winners, 1/day
  original: "original", // "do stuff -> share it"
  growth: "remix-or-original", // winner amplification, volume scaling
  monetization: "remix-or-original",
};

export function currentPhase(station) {
  return phaseForDay(station.currentDay);
}

export function contentModeFor(station) {
  const phase = currentPhase(station);
  const mode = PHASE_CONTENT[phase];
  if (mode === "remix-or-original") {
    // In growth/monetization, favor amplifying winners (remix) but mix in
    // originals. Deterministic by day so it's reproducible.
    return station.currentDay % 3 === 0 ? "original" : "remix";
  }
  return mode;
}

export function shouldPost(station) {
  return contentModeFor(station) !== null && !station.killed;
}

// Advance the station one day and return the phase it just entered (if changed).
export function advanceDay(station) {
  const before = currentPhase(station);
  station.currentDay += 1;
  const after = currentPhase(station);
  return { changed: before !== after, from: before, to: after };
}

// The article's hard behavioral rules, surfaced as a phase-aware capability map
// the orchestrator checks before acting.
export function capabilities(station) {
  return {
    canSwitchNiche: station.currentDay >= POLICY.NO_NICHE_SWITCH_BEFORE_DAY,
    canSell: station.currentDay >= POLICY.NO_SELLING_BEFORE_DAY,
    canPost: shouldPost(station),
    contentMode: contentModeFor(station),
    phase: currentPhase(station),
  };
}
