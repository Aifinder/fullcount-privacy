// §2.3 Winner Mining Agent (Viral Research).
// Crawls each niche's top creators, filters to proven winners (≥1M views when
// the station has no winners of its own), extracts the two "copy exactly"
// assets — on-screen title + opener — plus format metadata, scores them, and
// maintains the Opener Library. Dedup guarantees two stations in the same
// niche never remix the same source in the same week.

import { POLICY } from "../core/policies.js";
import { isoWeek, seededRng } from "../core/util.js";

export class WinnerMiningAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Refresh the Opener Library for a niche (runs nightly, §5).
  refresh(nicheId, day) {
    const niche = { id: nicheId };
    const creators = this.provider.searchTopCreators(niche, day);
    let added = 0;
    for (const creator of creators) {
      if (!creator.verified) continue;
      for (const vid of creator.videos) {
        if (vid.views < POLICY.MIN_SOURCE_VIEWS_WHEN_NO_WINNERS) continue;
        if (this.db.byId("openers", vid.id)) continue; // already known
        this.db.insert("openers", this._toOpener(nicheId, creator, vid, day));
        added++;
      }
    }
    if (added) {
      this.db.logEvent({
        agent: "winner-mining",
        msg: `${nicheId}: +${added} openers (library now ${this._libraryFor(nicheId).length})`,
      });
    }
    return added;
  }

  _toOpener(nicheId, creator, vid, day) {
    return {
      id: vid.id,
      nicheId,
      sourceCreator: creator.handle,
      title: vid.title, // COPY EXACTLY (§2.5 locked field)
      opener: vid.opener, // COPY EXACTLY (§2.5 locked field)
      format: vid.format,
      views: vid.views,
      ageDays: vid.ageDays,
      discoveredDay: day,
      score: this._score(vid),
      usedBy: [], // [{stationId, week}] — powers dedup
      internalPerf: [], // internally-validated performance when remixed (§2.9)
    };
  }

  // Score openers by views, recency, velocity, and niche fit (§2.3).
  _score(vid) {
    const viewScore = Math.min(Math.log10(vid.views) / 8, 1); // 1e8 => ~1
    const recency = Math.max(0, 1 - vid.ageDays / 120);
    const velocity = Math.min(vid.views / (vid.ageDays + 1) / 200_000, 1);
    return +(viewScore * 0.5 + recency * 0.2 + velocity * 0.3).toFixed(3);
  }

  _libraryFor(nicheId) {
    return this.db.filter("openers", (o) => o.nicheId === nicheId);
  }

  // Pick the best available opener for a station this week, respecting dedup
  // (§2.3 / §6.4). Prefers internally-validated patterns (§2.9) when they
  // exist. Returns null if the library is exhausted for this station's week.
  pickForStation(station, day) {
    const week = isoWeek(day);
    const lib = this._libraryFor(station.niche)
      .filter((o) => !o.usedBy.some((u) => u.stationId === station.id)) // this station never repeats a source
      .filter((o) => !o.usedBy.some((u) => u.week === week && u.stationId !== station.id)) // no cross-station collision same week
      .sort((a, b) => effectiveScore(b) - effectiveScore(a));

    if (!lib.length) return null;
    const chosen = lib[0];
    chosen.usedBy.push({ stationId: station.id, week, day });
    return chosen;
  }
}

// Internally-validated openers (ones that beat a station median when remixed)
// get a boost so the whole portfolio learns from itself (§2.9 feedback loop).
function effectiveScore(opener) {
  const wins = opener.internalPerf.filter((p) => p.winner).length;
  return opener.score + Math.min(wins * 0.05, 0.25);
}
