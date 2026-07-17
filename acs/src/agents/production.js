// §2.6 Production Agent.
// The article assumes a human filming on a phone; at scale this is automated.
// Default faceless pipeline (TTS + kinetic text + auto-subtitles + top-frame
// title rendered to match the source winner's styling). A QA pass validates
// title/opener verbatim-match, duration, caption sync, and audio levels — the
// automated stand-in for the human "watch it back" check.

import { seededRng, clamp } from "../core/util.js";

export class ProductionAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  render(station, persona, script) {
    const rng = seededRng("render", script.id);
    const asset = {
      id: `asset_${script.id}`,
      stationId: station.id,
      scriptId: script.id,
      pipeline: station.pipeline, // "faceless" | "avatar" | "text"
      durationSec: script.format.durationSec ?? 28,
      renderedTitle: script.title, // rendered top-frame, matching source styling
      renderedOpener: script.openerLine,
      captions: { positioned: "lower-third", syncOffsetMs: Math.round((rng() - 0.5) * 60) },
      voiceModel: persona.visualIdentity.voiceModel,
      palette: persona.visualIdentity.palette,
      disclosureLabel: script.disclosure ? "AI-generated" : null,
      audioLufs: -14 + (rng() - 0.5) * 2,
    };
    const qa = this._qa(script, asset);
    asset.qa = qa;
    return asset;
  }

  // QA gate (§2.6 / §6.6). Returns pass/fail with reasons. A hard fail blocks
  // publishing and routes to the ops failure queue.
  _qa(script, asset) {
    const issues = [];
    // title/opener verbatim-match against the script's locked fields
    if (asset.renderedTitle !== script.title) issues.push("title_mismatch");
    if (asset.renderedOpener !== script.openerLine) issues.push("opener_mismatch");
    // opener must be the literal first thing said
    if (!script.body || !script.openerLine) issues.push("empty_field");
    // duration sanity for shorts
    if (asset.durationSec > 45) issues.push("too_long");
    // audio levels within broadcast-ish range
    if (asset.audioLufs < -18 || asset.audioLufs > -10) issues.push("audio_levels");
    // caption sync tolerance
    if (Math.abs(asset.captions.syncOffsetMs) > 120) issues.push("caption_desync");
    return { pass: issues.length === 0, issues };
  }
}
