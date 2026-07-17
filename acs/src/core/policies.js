// The article's behavioral rules, encoded as HARD constraints.
// The orchestrator consults these before every state transition and action.
// A policy violation is a denial, not a warning — this is the whole point of
// turning a solo-human playbook into a governed multi-station system.

export const POLICY = {
  // Lifecycle gates (§1 station lifecycle / §2.1 orchestrator).
  NO_NICHE_SWITCH_BEFORE_DAY: 30,
  NO_SELLING_BEFORE_DAY: 60,

  // Winner mining thresholds (§2.3).
  MIN_SOURCE_VIEWS_WHEN_NO_WINNERS: 1_000_000,

  // Script constraints (§2.5).
  SHORTS_WORD_CAP: 70,
  SHORTS_SECONDS_CAP: 30,

  // Originality guard (§2.11 / §6.3). Verbatim copying is allowed ONLY for
  // title + opener; the remixed body may not resemble the source too closely.
  MAX_BODY_SIMILARITY_TO_SOURCE: 0.5,

  // Dedup (§2.3 / §6.4): two stations in the same niche may not remix the
  // same source winner within the same week bucket.
  DEDUP_WINDOW_WEEKS: 1,

  // Engagement (§2.8): reply to every comment inside a 2-hour window, then
  // re-decide based on view velocity.
  ENGAGEMENT_WINDOW_HOURS: 2,
  // Below this fraction of peak velocity we consider the post "flat".
  VELOCITY_FLAT_RATIO: 0.25,

  // Publishing (§2.7): one post/day minimum; never backfill-spam a missed day.
  POSTS_PER_DAY: 1,
  NO_BACKFILL: true,
  HASHTAGS_PER_POST: 3,

  // Winner detection (§2.9): a post is a "winner" if it beats the station's
  // own running median by this multiple. Relative, not absolute.
  WINNER_MEDIAN_MULTIPLE: 2,
  // If no winner has emerged by this post index, escalate remix fidelity.
  WINNER_ESCALATION_POST: 20,

  // Monetization trust thresholds (§2.10) — ALL must hold, on top of day 60.
  MONETIZATION_MIN_FOLLOWERS: 1000,
  MONETIZATION_MIN_REPEAT_ENGAGERS: 15,
  MONETIZATION_MIN_MEAN_COMMENT_QUALITY: 0.5,

  // Compliance / account health (§2.11).
  SHADOWBAN_REACH_DROP_RATIO: 0.35, // sustained reach below 35% of median => suspect
  MAX_REPLIES_PER_HOUR: 40, // human-plausible cadence cap
};

// Phase boundaries as [startDay, endDay] inclusive-ish. Growth and
// monetization are open-ended (endDay = Infinity).
export const PHASES = [
  { name: "bootstrap", start: 1, end: 3 },
  { name: "research", start: 4, end: 7 },
  { name: "remix", start: 8, end: 24 },
  { name: "original", start: 25, end: 29 },
  { name: "growth", start: 30, end: 59 },
  { name: "monetization", start: 60, end: Infinity },
];

export function phaseForDay(day) {
  return PHASES.find((p) => day >= p.start && day <= p.end)?.name ?? "bootstrap";
}

// Guard used by the orchestrator before allowing a niche change.
export function canSwitchNiche(station) {
  return station.currentDay >= POLICY.NO_NICHE_SWITCH_BEFORE_DAY;
}

// Guard used before the monetization agent may propose an offer.
export function monetizationEligibility(station) {
  const reasons = [];
  if (station.currentDay < POLICY.NO_SELLING_BEFORE_DAY) {
    reasons.push(`day ${station.currentDay} < ${POLICY.NO_SELLING_BEFORE_DAY}`);
  }
  if (station.followers < POLICY.MONETIZATION_MIN_FOLLOWERS) {
    reasons.push(
      `followers ${station.followers} < ${POLICY.MONETIZATION_MIN_FOLLOWERS}`,
    );
  }
  if (station.repeatEngagers < POLICY.MONETIZATION_MIN_REPEAT_ENGAGERS) {
    reasons.push(
      `repeat engagers ${station.repeatEngagers} < ${POLICY.MONETIZATION_MIN_REPEAT_ENGAGERS}`,
    );
  }
  if (station.meanCommentQuality < POLICY.MONETIZATION_MIN_MEAN_COMMENT_QUALITY) {
    reasons.push(
      `comment quality ${station.meanCommentQuality.toFixed(2)} < ${POLICY.MONETIZATION_MIN_MEAN_COMMENT_QUALITY}`,
    );
  }
  return { eligible: reasons.length === 0, reasons };
}
