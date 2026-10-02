import { describe, expect, it } from "vitest";
import shipped from "../data/catalog.json";
import {
  SOLVE_TAGS,
  compareVersions,
  entriesSolving,
  matchDetections,
  mergeCatalogs,
  parseCatalog,
  parseEntry,
  type Catalog,
  type CatalogEntry,
} from "./catalog";

const entry = (over: Partial<CatalogEntry> & { id: string }): CatalogEntry => ({
  name: over.id,
  kind: "cli",
  what: "Does a thing.",
  solves: ["testing"],
  agents: ["any"],
  detect: {},
  source: "https://example.com",
  verified: true,
  updated: "2026-10-01",
  ...over,
});
const cat = (version: string, entries: CatalogEntry[]): Catalog => ({ version, updated: "2026-10-01", entries });

describe("parseCatalog", () => {
  it("rejects non-catalogs", () => {
    expect(parseCatalog(null)).toBeNull();
    expect(parseCatalog("x")).toBeNull();
    expect(parseCatalog({ entries: "nope" })).toBeNull();
    expect(parseCatalog([])).toBeNull();
  });

  it("keeps good entries and drops bad or duplicate ones", () => {
    const good = entry({ id: "gh", detect: { bins: ["GH"] } });
    const c = parseCatalog({
      version: "2",
      updated: "2026-10-01",
      entries: [
        good,
        { ...good, id: "Not Kebab" },
        { ...good, id: "bad-kind", kind: "robot" },
        { ...good, id: "bad-source", source: "javascript:alert(1)" },
        { ...good, id: "no-agents", agents: [] },
        { ...good, id: "bad-detect", detect: { bins: "gh" } },
        { ...good, id: "mcp-no-target", install: { docs: "https://x.dev", mcp: { name: "x" } } },
        { ...good, id: "no-docs", install: { command: "brew install x" } },
        good, // duplicate id
        42,
      ],
    })!;
    expect(c.version).toBe("2");
    expect(c.entries.map((e) => e.id)).toEqual(["gh"]);
    expect(c.entries[0].detect.bins).toEqual(["gh"]); // lowercased
  });

  it("drops unknown solve tags but keeps the entry", () => {
    const e = parseEntry({ ...entry({ id: "x" }), solves: ["testing", "time-travel"] })!;
    expect(e.solves).toEqual(["testing"]);
  });

  it("keeps a valid mcp install", () => {
    const e = parseEntry({
      ...entry({ id: "linear", kind: "mcp" }),
      install: { docs: "https://linear.app/docs/mcp", mcp: { name: "linear", url: "https://mcp.linear.app/mcp" } },
    })!;
    expect(e.install?.mcp?.url).toBe("https://mcp.linear.app/mcp");
  });
});

describe("mergeCatalogs", () => {
  const builtin = cat("2026.10.1", [entry({ id: "a", what: "old a" }), entry({ id: "b" })]);

  it("ignores an older or equal remote", () => {
    const remote = cat("2026.9.30", [entry({ id: "a", what: "remote a" })]);
    const m = mergeCatalogs(builtin, remote, null);
    expect(m.version).toBe("2026.10.1");
    expect(m.entries.find((e) => e.id === "a")!.what).toBe("old a");
    expect(mergeCatalogs(builtin, cat("2026.10.1", [entry({ id: "z" })])).entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("a newer remote replaces per id and adds new ones", () => {
    const remote = cat("2026.10.2", [entry({ id: "a", what: "remote a" }), entry({ id: "c" })]);
    const m = mergeCatalogs(builtin, remote, null);
    expect(m.version).toBe("2026.10.2");
    expect(m.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(m.entries[0].what).toBe("remote a");
  });

  it("local additions are kept unverified and never shadow a known id", () => {
    const local = cat("0", [entry({ id: "mine", verified: true }), entry({ id: "b", what: "hijack" })]);
    const m = mergeCatalogs(builtin, null, local);
    expect(m.entries.map((e) => e.id)).toEqual(["a", "b", "mine"]);
    expect(m.entries.find((e) => e.id === "b")!.what).toBe("Does a thing.");
    expect(m.entries.find((e) => e.id === "mine")!.verified).toBe(false);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("2026.10.2", "2026.9.30")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2", "1.10")).toBe(-1);
  });
});

describe("matchDetections", () => {
  const c = cat("1", [
    entry({ id: "linear-mcp", kind: "mcp", detect: { mcp: ["linear", "mcp.linear.app"] } }),
    entry({ id: "playwright-mcp", kind: "mcp", detect: { mcp: ["@playwright/mcp"] } }),
    entry({ id: "memory-mcp", kind: "mcp", detect: { mcp: ["memory"] } }),
    entry({ id: "cursor", kind: "agent", detect: { apps: ["Cursor.app"], bins: ["cursor"] } }),
    entry({ id: "superpowers", kind: "plugin", detect: { plugins: ["superpowers"] } }),
    entry({ id: "vitest", detect: { deps: ["vitest"] } }),
    entry({ id: "nothing", detect: {} }),
  ]);
  const ids = (found: Parameters<typeof matchDetections>[1]) => matchDetections(c, found).map((e) => e.id);

  it("matches case-insensitively", () => {
    expect(ids({ apps: ["cursor.app"] })).toEqual(["cursor"]);
    expect(ids({ bins: ["CURSOR"] })).toEqual(["cursor"]);
    expect(ids({ deps: ["Vitest"] })).toEqual(["vitest"]);
  });

  it("matches mcp hosts and packages as substrings, bare names exactly", () => {
    expect(ids({ mcp: ["https://mcp.linear.app/mcp"] })).toEqual(["linear-mcp"]);
    expect(ids({ mcp: ["npx -y @playwright/mcp@latest"] })).toEqual(["playwright-mcp"]);
    expect(ids({ mcp: ["Linear"] })).toEqual(["linear-mcp"]);
    expect(ids({ mcp: ["supermemory"] })).toEqual([]);
  });

  it("strips the marketplace from plugin names", () => {
    expect(ids({ plugins: ["superpowers@superpowers-marketplace"] })).toEqual(["superpowers"]);
  });

  it("finds nothing in an empty scan", () => {
    expect(ids({})).toEqual([]);
  });
});

describe("entriesSolving", () => {
  const c = cat("1", [
    entry({ id: "any-tool", solves: ["browser"], verified: false }),
    entry({ id: "claude-only", solves: ["browser"], agents: ["claude"] }),
    entry({ id: "codex-only", solves: ["browser"], agents: ["codex"] }),
    entry({ id: "other-tag", solves: ["docs"] }),
  ]);

  it("filters by tag and agent, verified first", () => {
    expect(entriesSolving(c, "browser", ["claude"]).map((e) => e.id)).toEqual(["claude-only", "any-tool"]);
    expect(entriesSolving(c, "browser", ["CODEX"]).map((e) => e.id)).toEqual(["codex-only", "any-tool"]);
    expect(entriesSolving(c, "browser").map((e) => e.id)).toEqual(["claude-only", "codex-only", "any-tool"]);
    expect(entriesSolving(c, "payments", ["claude"])).toEqual([]);
  });
});

describe("shipped catalog.json", () => {
  const raw = shipped as unknown as { version: string; updated: string; entries: unknown[] };
  const parsed = parseCatalog(raw)!;

  it("parses with every entry valid and ids unique", () => {
    expect(parsed).not.toBeNull();
    expect(raw.entries.length).toBeGreaterThanOrEqual(60);
    expect(parsed.entries.length).toBe(raw.entries.length);
    expect(new Set(parsed.entries.map((e) => e.id)).size).toBe(parsed.entries.length);
  });

  it("uses only known solve tags, 1-4 per entry", () => {
    for (const r of raw.entries as { id: string; solves: string[] }[]) {
      expect(r.solves.length, r.id).toBeGreaterThanOrEqual(1);
      expect(r.solves.length, r.id).toBeLessThanOrEqual(4);
      for (const t of r.solves) expect(SOLVE_TAGS, `${r.id}: ${t}`).toContain(t);
    }
  });

  it("every mcp install has a url or command, every URL is https", () => {
    for (const e of parsed.entries) {
      expect(e.source.startsWith("https://"), e.id).toBe(true);
      if (e.install) expect(e.install.docs.startsWith("https://"), e.id).toBe(true);
      const m = e.install?.mcp;
      if (m) {
        expect(Boolean(m.url || m.command), e.id).toBe(true);
        if (m.url) expect(m.url.startsWith("https://"), e.id).toBe(true);
      }
    }
  });

  it("detect names are lowercase (except app bundles) and every entry is detectable", () => {
    for (const e of raw.entries as CatalogEntry[]) {
      const keys = Object.keys(e.detect);
      expect(keys.length, e.id).toBeGreaterThan(0);
      for (const [k, list] of Object.entries(e.detect)) {
        if (k === "apps") continue;
        for (const s of list as string[]) expect(s, e.id).toBe(s.toLowerCase());
      }
    }
  });

  it("has a version and dated entries", () => {
    expect(parsed.version).toMatch(/\d/);
    for (const e of parsed.entries) expect(e.updated, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
