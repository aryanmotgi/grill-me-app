// ---------------------------------------------------------------------------
// The Spark, inside the app: it reads your Coding DNA and
//   notices   short, specific things worth your attention (pure rules):
//             check-ins on Evolutions, rules waiting for your OK, new
//             struggles, tools you never touch, wins
//   answers   questions about your setup, grounded in your DNA (your AI);
//             when you tell it something new about how you work, it offers
//             to save it, only if you say so
// Pure: the UI runs the AI call and applies what you accept.
// ---------------------------------------------------------------------------

import { dnaBrief, type CodingDNA, type Strand } from "./dna";

export type NoticeKind = "checkin" | "rules" | "struggle" | "idle" | "win";
export interface Notice {
  id: string;
  kind: NoticeKind;
  text: string;
  /** what the buttons do (the UI wires them) */
  actions: ("helped-yes" | "helped-no" | "helped-unsure" | "open-rules" | "open-evolutions" | "open-toolkit" | "dismiss")[];
  /** the Evolution / pattern it's about */
  ref?: string;
}

const DAY = 86400_000;
const CHECKIN_AFTER = 14 * DAY;

/** What's worth saying now, most useful first. Dismissed ones stay quiet. */
export function notices(dna: CodingDNA, now = Date.now()): Notice[] {
  const out: Notice[] = [];
  const quiet = new Set(dna.muted);
  const add = (n: Notice) => { if (!quiet.has(n.id)) out.push(n); };
  // 2-week check-ins on what you added
  for (const e of dna.evolutions) {
    if (!e.installedAt || e.helped || e.dismissed || now - e.installedAt < CHECKIN_AFTER) continue;
    const weeks = Math.round((now - e.installedAt) / (7 * DAY));
    add({ id: `notice:checkin:${e.id}`, kind: "checkin", ref: e.id, actions: ["helped-yes", "helped-no", "helped-unsure"],
      text: `You added ${e.name} ${weeks} week${weeks === 1 ? "" : "s"} ago${e.uses ? ` and used it ${e.uses} times` : ", and haven't used it yet"}. Did it help?` });
  }
  // rules waiting for your OK
  const proposed = dna.rules.filter((r) => r.status === "proposed");
  if (proposed.length) add({ id: `notice:rules:${proposed.map((r) => r.id).join(",")}`, kind: "rules", actions: ["open-rules", "dismiss"],
    text: proposed.length === 1 ? `One rule is waiting for your OK: "${proposed[0].text}"` : `${proposed.length} rules are waiting for your OK, starting with "${proposed[0].text}"` });
  // struggles the sessions show
  for (const l of dna.learned.filter((x) => x.strand === "pains" && x.source === "sessions")) {
    add({ id: `notice:${l.id}`, kind: "struggle", ref: l.id, actions: ["open-evolutions", "dismiss"], text: `${l.text} There's an Evolution for that.` });
  }
  // tools you never touch
  for (const l of dna.learned.filter((x) => x.id.includes(":idle:") || x.id.includes(":evo-idle:"))) {
    add({ id: `notice:${l.id}`, kind: "idle", ref: l.id, actions: ["open-toolkit", "dismiss"], text: `${l.text} Keep it, or let it go?` });
  }
  // wins
  for (const w of dna.wins.filter((x) => x.source !== "you")) add({ id: `notice:${w.id}`, kind: "win", ref: w.id, actions: ["dismiss"], text: `Nice: ${w.text}.` });
  const order: NoticeKind[] = ["checkin", "rules", "struggle", "win", "idle"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 6);
}

/** Dismissing a notice keeps it quiet. */
export const quietNotice = (dna: CodingDNA, id: string): CodingDNA => ({ ...dna, muted: [...new Set([...dna.muted, id])].slice(-300), updated: Date.now() });

// -- asking the Spark ------------------------------------------------------------------

export const SPARK_SYSTEM = [
  "You are the Spark, Grill Me's coding coach. You know this developer through their Coding DNA (below): how they work, their toolkit, their rules, habits, pains and wins.",
  "Answer their question in 2 to 5 short sentences, specific to them. Use their DNA; don't invent facts about them. If you recommend a tool, say why it fits them.",
  "`remember`: only facts they STATED in this question about how they work, that aren't in the DNA yet, as one short line in the second person (e.g. they wrote \"I always just rerun them\" -> habits: \"You rerun flaky tests until they pass\"; \"I only ever use Go\" -> habits: \"You work only in Go\"). Never infer, guess or praise. If they stated nothing new, `remember` is [].",
].join("\n");

export const SPARK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answer", "remember"],
  properties: {
    answer: { type: "string" },
    remember: {
      type: "array", maxItems: 2,
      items: { type: "object", additionalProperties: false, required: ["strand", "text"], properties: { strand: { type: "string", enum: ["flow", "habits", "pains", "rules", "wins"] }, text: { type: "string" } } },
    },
  },
} as const;

export function sparkPrompt(dna: CodingDNA, question: string): string {
  return [`Their Coding DNA:\n${dnaBrief(dna, 3000) || "(nothing yet)"}`, `Their question: ${question.trim().slice(0, 1000)}`].join("\n\n");
}

export interface SparkAnswer { answer: string; remember: { strand: Exclude<Strand, "toolkit">; text: string }[] }
/** Keep only a sane answer and well-formed things to remember. */
export function parseSpark(raw: unknown): SparkAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const answer = typeof r.answer === "string" ? r.answer.trim().slice(0, 1500) : "";
  if (!answer) return null;
  const ok = ["flow", "habits", "pains", "rules", "wins"];
  const remember = (Array.isArray(r.remember) ? r.remember : []).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const { strand, text } = x as Record<string, unknown>;
    return ok.includes(strand as string) && typeof text === "string" && text.trim().length >= 6 ? [{ strand: strand as SparkAnswer["remember"][number]["strand"], text: text.trim().slice(0, 200) }] : [];
  }).slice(0, 2);
  return { answer, remember };
}
