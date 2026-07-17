// §2.4 Persona & Voice Agent.
// One persistent persona per station: name, bio, backstory, voice, banned
// words. Automates the article's "answer 3 personalization questions once"
// into a persistent voice document injected into every script prompt, and
// runs the "would this persona ever say this word?" filter (the read-aloud
// edit step). Also owns faceless visual identity.

import { seededRng, pick, shortId } from "../core/util.js";
import * as C from "../core/corpus.js";

export class PersonaAgent {
  constructor(db, provider) {
    this.db = db;
    this.provider = provider;
  }

  // Seeded "interview" -> persistent voice document (§2.4). Created once per
  // station at bootstrap; stored in the Persona Store and never regenerated
  // (backstory canon prevents contradiction across posts).
  create(station, brief) {
    const rng = seededRng("persona", station.id);
    const voice = pick(rng, C.PERSONA_VOICES);
    const name = pick(rng, C.FIRST_NAMES);
    const persona = {
      id: shortId("persona", rng),
      stationId: station.id,
      name,
      bio: brief.statement, // niche brief doubles as the bio (§2.2)
      tone: voice.tone,
      quirk: voice.quirk,
      bannedWords: voice.banned,
      backstory: `${name} spent two years figuring out ${brief.what} the hard way and now shares the shortcuts, like texting a friend.`,
      recurringAnecdotes: [
        `the time ${name} wasted a whole weekend on ${brief.what}`,
        `${name}'s "one dumb rule that fixed everything"`,
      ],
      visualIdentity: {
        // faceless station identity (§2.4 / §2.6)
        palette: pick(rng, [["#0B1220", "#F5C518"], ["#101820", "#00E5A0"], ["#1A1035", "#FF5DA2"]]),
        font: pick(rng, ["Inter", "Poppins", "Archivo"]),
        broll: pick(rng, ["screen-record", "stock-b-roll", "generated"]),
        voiceModel: pick(rng, ["neural-warm-f", "neural-bright-m", "neural-calm-f"]),
      },
    };
    this.db.insert("personas", persona);
    this.db.logEvent({ agent: "persona", stationId: station.id, msg: `created persona "${name}" (${voice.tone})` });
    return persona;
  }

  get(stationId) {
    return this.db.find("personas", (p) => p.stationId === stationId);
  }

  // The persona-consistency filter (§2.4 / §6.6). Returns a score 0..1 and the
  // offending words. The script agent rewrites until this passes.
  filter(persona, text) {
    const lower = text.toLowerCase();
    const hits = persona.bannedWords.filter((w) => lower.includes(w.toLowerCase()));
    const score = hits.length === 0 ? 1 : Math.max(0, 1 - hits.length * 0.34);
    return { pass: hits.length === 0, score, offending: hits };
  }
}
