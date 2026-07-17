// Static seed content for the simulation. In production none of this is
// hard-coded — creators/videos come from platform search (§2.3), personas
// from a seeded interview (§2.4), comments from real audiences. Here it's a
// bank the simulation provider draws from deterministically.

export const NICHES = [
  { id: "ai-productivity", label: "AI productivity for solopreneurs", demand: 0.92, cpm: 18, aiAdjacent: true },
  { id: "home-cooking", label: "15-minute home cooking", demand: 0.81, cpm: 9, aiAdjacent: false },
  { id: "personal-finance", label: "personal finance for 20-somethings", demand: 0.88, cpm: 22, aiAdjacent: true },
  { id: "houseplants", label: "houseplant care", demand: 0.66, cpm: 7, aiAdjacent: false },
  { id: "strength-training", label: "beginner strength training", demand: 0.79, cpm: 11, aiAdjacent: false },
  { id: "notion-systems", label: "Notion systems & templates", demand: 0.74, cpm: 14, aiAdjacent: true },
  { id: "indie-hacking", label: "indie hacking & micro-SaaS", demand: 0.83, cpm: 20, aiAdjacent: true },
  { id: "sleep-health", label: "sleep & recovery science", demand: 0.71, cpm: 13, aiAdjacent: true },
  { id: "watercolor", label: "watercolor for beginners", demand: 0.52, cpm: 6, aiAdjacent: false },
  { id: "car-detailing", label: "car detailing at home", demand: 0.63, cpm: 8, aiAdjacent: false },
  { id: "resume-career", label: "resume & career switching", demand: 0.77, cpm: 17, aiAdjacent: true },
  { id: "budget-travel", label: "budget travel hacks", demand: 0.69, cpm: 10, aiAdjacent: false },
];

// Opener templates — the "first 5 seconds / first 2 lines" the winner mining
// agent extracts and the script agent copies verbatim (§2.3 / §2.5).
export const OPENER_TEMPLATES = [
  "Stop doing {THING} the hard way.",
  "I tried {THING} for 30 days so you don't have to.",
  "Nobody tells you this about {THING}.",
  "The {THING} mistake that's costing you {STAKE}.",
  "You're {ADVERB} {THING} wrong. Here's the fix.",
  "This {THING} trick feels illegal to know.",
  "Delete these 3 {THING} habits today.",
  "{NUMBER} {THING} tips I wish I knew at 22.",
  "Watch this before you try {THING} again.",
  "The fastest way to {OUTCOME} without {PAIN}.",
];

export const TITLE_TEMPLATES = [
  "{NUMBER} {THING} tips that actually work",
  "How I {OUTCOME} in one week",
  "The only {THING} guide you need",
  "{THING}: what changed everything",
  "Do this, not that ({THING} edition)",
];

export const THING_BY_NICHE = {
  "ai-productivity": ["your inbox", "meeting notes", "your calendar", "AI prompts", "your to-do list"],
  "home-cooking": ["weeknight dinner", "meal prep", "rice", "pasta sauce", "chicken"],
  "personal-finance": ["your budget", "your credit score", "index funds", "saving money", "your first $10k"],
  houseplants: ["watering", "repotting", "your pothos", "fertilizer", "light placement"],
  "strength-training": ["your first pull-up", "squats", "progressive overload", "your warm-up", "protein"],
  "notion-systems": ["your second brain", "a CRM in Notion", "databases", "your dashboard", "templates"],
  "indie-hacking": ["your first sale", "landing pages", "pricing", "cold email", "shipping fast"],
  "sleep-health": ["your sleep", "your morning light", "caffeine timing", "naps", "your wind-down"],
  watercolor: ["washes", "your first landscape", "color mixing", "brush control", "wet-on-wet"],
  "car-detailing": ["your wheels", "swirl marks", "interior plastics", "the two-bucket method", "ceramic coating"],
  "resume-career": ["your resume", "the career switch", "your LinkedIn", "salary negotiation", "cover letters"],
  "budget-travel": ["cheap flights", "points", "your packing", "hostels", "off-season trips"],
};

export const OUTCOMES = ["got my first 1k followers", "fixed my sleep", "saved $3k", "shipped a product", "cooked all week in 2 hours"];
export const STAKES = ["thousands", "hours every week", "your best years", "real money"];
export const PAINS = ["burning out", "a gym", "spending a cent", "quitting your job"];
export const ADVERBS = ["probably", "definitely", "still", "quietly"];

// Persona voice seeds (§2.4). One line each; the persona agent expands these.
export const PERSONA_VOICES = [
  { tone: "warm-mentor", quirk: "starts sentences with 'okay so'", banned: ["synergy", "leverage", "utilize"] },
  { tone: "blunt-operator", quirk: "uses short punchy fragments", banned: ["literally", "amazing", "game-changer"] },
  { tone: "curious-nerd", quirk: "cites a tiny experiment", banned: ["guys", "smash", "viral"] },
  { tone: "dry-comedian", quirk: "undercuts with a joke", banned: ["please", "kindly", "furthermore"] },
];

export const FIRST_NAMES = ["Mara", "Deshawn", "Priya", "Owen", "Lena", "Tobias", "Sana", "Ivy", "Cole", "Noor", "Wren", "Hugo"];

export const COMMENT_BANK = {
  praise: ["this is so helpful", "needed this today", "saving this", "underrated account", "why is this not viral"],
  question: ["how do you do the first step?", "what tool is that?", "does this work if I'm a total beginner?", "can you make one for {THING}?", "how long did this take?"],
  painpoint: ["I always get stuck on {THING}", "I've wasted so much time on {THING}", "nobody explains {THING} clearly", "I keep failing at {THING}"],
  spam: ["check my profile 🔥🔥", "DM me to make $$$ fast", "follow for follow?", "🚀🚀🚀 link in bio"],
  abuse: ["this is garbage", "ratio", "who asked", "AI slop"],
};
