import { describe, expect, it } from "vitest";
import { headline, sessionSentence } from "./sessionSentence";

const t = (over: Record<string, unknown> = {}) => ({ status: "idle", currentFile: "—", changes: [], lastActiveMin: 0, ...over }) as Parameters<typeof sessionSentence>[0];
const ch = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `f${i}`, summary: "" })) as never;

describe("sessionSentence", () => {
  it("puts what needs you first", () => {
    expect(sessionSentence(t({ status: "needs-input" }))).toEqual({ text: "Waiting for your answer", tone: "needs" });
    expect(sessionSentence(t({ trustPrompt: true, status: "working" })).tone).toBe("needs");
    expect(sessionSentence(t({ rateLimited: true, rateLimitResetsAt: "3pm" })).text).toBe("Paused by the usage limit, back at 3pm");
  });
  it("says what it's working on", () => {
    expect(sessionSentence(t({ status: "working", currentFile: "src/app/Login.tsx" })).text).toBe("Working on Login.tsx");
    expect(sessionSentence(t({ status: "working" })).text).toBe("Working");
    expect(sessionSentence(t({ status: "working", flag: "stalled", lastActiveMin: 9 })).text).toBe("Quiet for 9m, may be stuck");
  });
  it("sums up a finished turn", () => {
    expect(sessionSentence(t()).text).toBe("Ready for your next message");
    expect(sessionSentence(t({ changes: ch(1) })).text).toBe("Done: 1 file changed");
    expect(sessionSentence(t({ changes: ch(3) }), true).text).toBe("Done: 3 files changed, tests pass");
    expect(sessionSentence(t({ changes: ch(3) }), false).tone).toBe("needs");
  });
});

describe("headline", () => {
  const r = (tone: string) => ({ said: { text: "", tone } }) as never;
  it("leads with what needs you, else sums up", () => {
    expect(headline([])).toMatch(/Nothing running/);
    expect(headline([r("needs"), r("working")])).toBe("One session needs you.");
    expect(headline([r("needs"), r("needs")])).toBe("2 sessions need you.");
    expect(headline([r("working"), r("done")])).toBe("All good: 1 working, 1 done and ready to review.");
    expect(headline([r("quiet")])).toMatch(/All quiet/);
  });
});
