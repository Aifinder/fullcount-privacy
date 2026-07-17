// §2.5 Script Generation Agent (Remix Engine).
// Strict template: LOCKED fields (title + opener) are copied verbatim from the
// source winner; REMIXED fields (the body) are regenerated in the station
// persona's voice with its own picks. Enforces the shorts word/second cap and
// "opener is literally the first thing said." In the original-content phase it
// switches to the Prompt 3/4 pattern: a weekly batch of sub-30-minute
// micro-experiments, executed/simulated, then scripted as "what I did / what
// surprised me."

import { POLICY } from "../core/policies.js";
import { seededRng, pick, pickN, wordCount, shortId } from "../core/util.js";
import * as C from "../core/corpus.js";

export class ScriptGenerationAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Remix phase: build a script from a source opener (§2.5).
  remix(station, persona, opener, day, { tightenFidelity = false } = {}) {
    const rng = seededRng("script", station.id, day);
    const things = C.THING_BY_NICHE[station.niche] || ["this"];

    // LOCKED — copied exactly.
    const title = opener.title;
    const openerLine = opener.opener;

    // REMIXED — persona's own picks/opinions/stories. Deliberately dissimilar
    // to any source body so the originality guard passes (§2.11).
    const picks = pickN(rng, things, 3);
    const bodyLines = [
      `${persona.name} here — ${pick(rng, persona.recurringAnecdotes)}.`,
      `Here's what actually moved the needle on ${picks[0]}:`,
      `1) ${picks[0]} — the ${persona.tone.split("-")[0]} way, not the textbook way.`,
      `2) ${picks[1]} — ${persona.quirk.includes("experiment") ? "I tested it, it works" : "steal this"}.`,
      `3) ${picks[2]} — the one I wish I'd known first.`,
      `Try it today. Tell me how it goes.`,
    ];
    // fidelity tightening (§2.9 escalation): trim body so opener carries more.
    const body = (tightenFidelity ? bodyLines.slice(0, 4) : bodyLines).join(" ");

    const script = this._assemble(station, day, {
      kind: "remix",
      title,
      openerLine,
      body,
      sourceOpenerId: opener.id,
      sourceScore: opener.score,
      format: opener.format,
      disclosure: true,
    });
    return script;
  }

  // Original phase: "do stuff -> share it" (§2.5 Prompt 3/4 pattern).
  // Generate a weekly list of 15 micro-experiments once, then each day script
  // the next one as "what I did / what surprised me."
  weeklyExperiments(station, day) {
    const rng = seededRng("experiments", station.id, Math.floor(day / 7));
    const things = C.THING_BY_NICHE[station.niche] || ["this"];
    const list = [];
    for (let i = 0; i < 15; i++) {
      const t = pick(rng, things);
      list.push({
        id: shortId("exp", rng),
        task: `Spend <30 min: ${pick(rng, ["test", "measure", "compare", "break", "speed-run"])} ${t}`,
        surprise: pick(rng, ["it was faster than expected", "the obvious way was wrong", "one setting changed everything", "it failed and that's the lesson"]),
      });
    }
    return list;
  }

  original(station, persona, experiment, day) {
    const rng = seededRng("orig", station.id, day);
    // In original phase the opener is self-generated but still front-loaded.
    const openerLine = this.provider.fillTemplate(pick(rng, C.OPENER_TEMPLATES), { id: station.niche }, rng);
    const title = `What surprised me: ${experiment.task.replace(/^Spend <30 min: /, "")}`;
    const body = [
      openerLine,
      `So ${persona.name} ${experiment.task.toLowerCase().replace(/^spend <30 min: /, "")}.`,
      `What surprised me: ${experiment.surprise}.`,
      `Here's the takeaway you can steal.`,
    ].join(" ");
    return this._assemble(station, day, {
      kind: "original",
      title,
      openerLine,
      body,
      sourceOpenerId: null,
      sourceScore: null,
      format: { pacing: "kinetic-text", style: "screen-record", durationSec: 28 },
      disclosure: true,
    });
  }

  _assemble(station, day, fields) {
    const rng = seededRng("assemble", station.id, day);
    const full = `${fields.openerLine} ${fields.body}`;
    let wc = wordCount(full);
    let trimmed = false;
    let openerLine = fields.openerLine;
    let body = fields.body;
    // Enforce the shorts cap: opener stays intact (it's the whole point),
    // trim the body from the end.
    if (station.platformKind === "short" && wc > POLICY.SHORTS_WORD_CAP) {
      const words = body.split(/\s+/);
      const room = Math.max(0, POLICY.SHORTS_WORD_CAP - wordCount(openerLine));
      body = words.slice(0, room).join(" ");
      trimmed = true;
      wc = wordCount(`${openerLine} ${body}`);
    }
    return {
      id: shortId("script", rng),
      stationId: station.id,
      kind: "script",
      scriptKind: fields.kind,
      day,
      title: fields.title,
      openerLine, // must be the first thing said (checked by production QA)
      body,
      sourceOpenerId: fields.sourceOpenerId,
      sourceScore: fields.sourceScore,
      format: fields.format,
      disclosure: fields.disclosure, // AI-content label (§2.6 / §6.5)
      wordCount: wc,
      trimmed,
    };
  }
}
