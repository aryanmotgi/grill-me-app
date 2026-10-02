import { describe, expect, it } from "vitest";
import { MAX_ANSWERS, MAX_TIPS, REPLY_SCHEMA, buildPrompt, knownFromScan, localSummary, mergeReply, openingFor, painsFromText, styleFromText, teamFromText } from "./interview";
import type { WorkflowProfile } from "./profile";

const empty = (): WorkflowProfile => ({ pains: [], agents: ["claude"], source: "form", updated: 0 });
const scan = { ts: 1, sources: [], checked: [], agents: { bins: ["claude"], apps: ["Cursor.app"] }, stack: { languages: ["TypeScript"], frameworks: ["Next.js"], dependencies: ["next", "vitest"] }, instructions: [], git: { commits30d: 42, usesPullRequests: true }, history: [{ cmd: "vercel", count: 3 }] };

describe("interview", () => {
  it("schema requires every field (Codex needs that) and allows nulls", () => {
    expect([...REPLY_SCHEMA.required].sort()).toEqual(Object.keys(REPLY_SCHEMA.properties).sort());
    expect(REPLY_SCHEMA.properties.building.enum).toContain(null);
    expect([...REPLY_SCHEMA.properties.notes.items.required].sort()).toEqual(["about", "text"]);
  });
  it("keeps only allowed values from the AI", () => {
    const r = mergeReply(empty(), { say: "Cool. Solo?", building: "web", team: "galaxy", style: null, pains: ["testing", "vibes", "review"], agents: ["codex", "skynet"], done: false });
    expect(r.say).toBe("Cool. Solo?");
    expect(r.options).toEqual([]);
    expect(r.profile.building).toBe("web");
    expect(r.profile.team).toBeUndefined();
    expect(r.profile.pains).toEqual(["testing", "review"]);
    expect(r.profile.agents).toEqual(["claude", "codex"]);
    expect(r.profile.source).toBe("interview");
  });
  it("keeps their words: notes and named tools add up, without repeats", () => {
    const one = mergeReply(empty(), { say: "Which part?", notes: [{ text: "Deploys to Vercel break", about: "deploy" }], mentions: ["Vercel"], done: false });
    const two = mergeReply(one.profile, { say: "And?", notes: [{ text: "deploys to vercel break!", about: "deploy" }, { text: "env vars differ in prod", about: "deploy" }], mentions: ["vercel", "github"], done: false });
    expect(two.profile.notes).toEqual([{ text: "Deploys to Vercel break", about: "deploy" }, { text: "env vars differ in prod", about: "deploy" }]);
    expect(two.profile.mentions).toEqual(["vercel", "github"]);
  });
  it("keeps the read-back summary when it's done", () => {
    const r = mergeReply(empty(), { say: "Thanks!", summary: "You plan first and lose time on reviews.", done: true });
    expect(r.done).toBe(true);
    expect(r.summary).toBe("You plan first and lose time on reviews.");
    expect(r.profile.summary).toBe(r.summary);
  });
  it("empty fields keep what we already had", () => {
    const before = { ...empty(), building: "web" as const, pains: ["testing" as const] };
    const r = mergeReply(before, { say: "", building: null, team: "small", pains: [], agents: [], done: true });
    expect(r.profile.building).toBe("web");
    expect(r.profile.team).toBe("small");
    expect(r.profile.pains).toEqual(["testing"]);
    expect(r.say.length).toBeGreaterThan(0);
  });
  it("survives garbage", () => {
    expect(mergeReply(empty(), null).profile.pains).toEqual([]);
    expect(mergeReply(empty(), "lol").done).toBe(false);
  });
  it("opens with what the scan saw", () => {
    expect(openingFor(scan as never)).toBe("I can see a Next.js web app with Claude Code and Cursor. Is it just you on it, or a team?");
    expect(openingFor(null)).toBe("Is it just you, or are you building with a team?");
  });
  it("tells the AI everything the scan knows, and when to wrap up", () => {
    const k = knownFromScan(scan as never);
    expect(k).toEqual(expect.arrayContaining([
      "Building: web", "Test tools in the project: vitest", "Ships with: vercel",
      "No agent instruction file (CLAUDE.md / AGENTS.md) with content", "42 commits in the last 30 days, uses pull requests",
    ]));
    const turns = Array.from({ length: MAX_ANSWERS - 1 }, () => [{ who: "ai" as const, text: "q" }, { who: "you" as const, text: "a" }]).flat();
    const p = buildPrompt(turns, empty(), scan as never);
    expect(p).toContain("don't ask");
    expect(p).toContain("last turn");
    expect(buildPrompt(turns.slice(0, 2), empty())).not.toContain("last turn");
  });
  it("a correction asks for a new summary and ends", () => {
    const p = buildPrompt([], { ...empty(), summary: "You test a lot." }, null, { correction: "it's migrations, not tests" });
    expect(p).toContain("it's migrations, not tests");
    expect(p).toContain("done=true");
  });
  it("caps very long answers in the prompt", () => {
    const long = buildPrompt([{ who: "you", text: "x".repeat(5000) }], empty());
    const short = buildPrompt([{ who: "you", text: "x" }], empty());
    expect(long.length - short.length).toBeLessThan(1000);
  });
  it("keeps a few short answer options, none once it's done", () => {
    expect(mergeReply(empty(), { say: "?", options: ["[]", " - ", "Yes"] }).options).toEqual(["Yes"]);
    const r = mergeReply(empty(), { say: "How do you plan?", options: ["Plan first", "", 42, "x".repeat(80), "a", "b", "c", "d"], done: false });
    expect(r.options).toHaveLength(5);
    expect(r.options[0]).toBe("Plan first");
    expect(r.options[1].length).toBe(60);
    expect(mergeReply(empty(), { say: "Thanks!", options: ["x"], done: true }).options).toEqual([]);
  });
  it("understands typed answers when there's no AI", () => {
    expect(teamFromText("just me lol")).toBe("solo");
    expect(teamFromText("7 engineers")).toBe("large");
    expect(teamFromText("me and my cofounder")).toBe("small");
    expect(styleFromText("I write a plan doc first")).toBe("plan-first");
    expect(styleFromText("mostly let the agent run")).toBe("agents");
    expect(painsFromText("deploying to vercel breaks and flaky tests")).toEqual(["testing", "debugging", "deploy"]);
    expect(painsFromText("nothing really")).toEqual([]);
  });
  it("writes a read-back without an AI", () => {
    expect(localSummary({ ...empty(), team: "solo", style: "plan-first", pains: ["testing", "deploy"] }))
      .toBe("You're building on your own, planning first and then letting AI code. Most of your time goes to testing and deploying.");
  });
  it("shows a tip only when it fits a real pain, never twice, at most two", () => {
    const base = { ...empty(), pains: ["deploy" as const] };
    const a = mergeReply(base, { say: "Which errors?", tip: "env-example", done: false });
    expect(a.tip?.id).toBe("env-example");
    expect(a.profile.tips).toEqual(["env-example"]);
    expect(mergeReply(a.profile, { say: "?", tip: "env-example" }).tip).toBeUndefined();
    expect(mergeReply(a.profile, { say: "?", tip: "flaky-loop" }).tip).toBeUndefined(); // no testing pain
    expect(mergeReply(a.profile, { say: "?", tip: "made-up" }).tip).toBeUndefined();
    const b = mergeReply(a.profile, { say: "?", tip: "build-locally" });
    expect(b.profile.tips).toHaveLength(MAX_TIPS);
    expect(mergeReply(b.profile, { say: "?", tip: "pin-runtime" }).tip).toBeUndefined();
  });
  it("a tip fits a pain they only described in a note", () => {
    const r = mergeReply(empty(), { say: "?", notes: [{ text: "my flaky tests", about: "testing" }], tip: "flaky-loop" });
    expect(r.tip?.id).toBe("flaky-loop");
  });
  it("keeps the level, and a challenge only while chatting", () => {
    expect(mergeReply(empty(), { say: "?", level: "senior", challenge: true }).profile.level).toBe("senior");
    expect(mergeReply(empty(), { say: "?", level: "wizard" }).profile.level).toBeUndefined();
    expect(mergeReply(empty(), { say: "?", challenge: true }).challenge).toBe(true);
    expect(mergeReply(empty(), { say: "Thanks", challenge: true, done: true }).challenge).toBe(false);
  });
  it("tells the AI its level guess, the tips left, and when not to challenge", () => {
    const p = buildPrompt([{ who: "you", text: "hi" }], empty(), scan as never);
    expect(p).toContain("Tip menu:");
    expect(p).toMatch(/Their level so far: \w+ \(a guess from the scan\)/);
    expect(buildPrompt([], empty(), null, { gentle: true })).toContain("go easy");
    expect(buildPrompt([], empty(), null, { challenged: true })).toContain("no more challenges");
    const full = buildPrompt([], { ...empty(), tips: ["a", "b"] }, null);
    expect(full).toContain("No more tips");
    expect(full).not.toContain("Tip menu:");
  });
});
