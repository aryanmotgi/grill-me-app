import { describe, expect, it } from "vitest";
import { fileRings, inside, layoutGalaxy, layoutTree, viewOf, type SpaceEntry } from "./layout";
import { partOf, readArchMap } from "./archify";

const e = (path: string, kind: "folder" | "file" = "file"): SpaceEntry => ({
  path, parent: path.split("/").slice(0, -1).join("/") || null, name: path.split("/").pop()!, kind,
});

describe("code space layout", () => {
  const entries = [e("/r", "folder"), e("/r/src", "folder"), e("/r/src/a.ts"), e("/r/src/b.ts"), e("/r/docs", "folder"), e("/r/docs/x.md"), e("/r/README.md")];
  const placed = layoutTree(entries, "/r");
  const at = (p: string) => placed.find((x) => x.path === p)!;

  it("places every entry once, the root in the middle", () => {
    expect(placed).toHaveLength(entries.length);
    expect(at("/r").pos).toEqual([0, 0, 0]);
  });
  it("hangs folders a level lower and files just under their folder", () => {
    expect(at("/r/src").pos[1]).toBeLessThan(0);
    expect(at("/r/src/a.ts").pos[1]).toBeLessThan(at("/r/src").pos[1]);
    expect(at("/r/README.md").pos[1]).toBeLessThan(0);
    expect(at("/r/src/a.ts").depth).toBe(2);
  });
  it("keeps sibling folders apart", () => {
    const a = at("/r/src").pos, b = at("/r/docs").pos;
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(5);
  });
  it("rings files without stacking them", () => {
    const ring = fileRings(10, 0, 0, 0);
    const keys = new Set(ring.map((p) => p.map((n) => n.toFixed(2)).join()));
    expect(keys.size).toBe(10);
    expect(fileRings(1, 1, 2, 3)).toEqual([[1, 2 - 2.6, 3]]);
  });
  it("spreads many projects on a spiral and frames what you pick", () => {
    const g = layoutGalaxy([e("/a", "folder"), e("/b", "folder"), e("/c", "folder")]);
    expect(new Set(g.map((p) => p.pos.join())).size).toBe(3);
    const v = viewOf(at("/r/src"));
    expect(v.camera[1]).toBeGreaterThan(v.target[1]);
    expect(inside("/r/src/a.ts", "/r/src")).toBe(true);
    expect(inside("/r/srcx/a.ts", "/r/src")).toBe(false);
  });
});

describe("archify parts", () => {
  const map = readArchMap({
    components: [
      { id: "screens", label: "Screens", type: "frontend", sources: [{ path: "src/App.tsx" }, { path: "src/components/Chat.tsx" }] },
      { id: "core", label: "Backend", type: "backend", sources: [{ path: "src-tauri/src/lib.rs" }] },
      { label: "no id" },
    ],
    connections: [{ from: "screens", to: "core", label: "calls" }, { from: "x" }],
  })!;
  it("reads parts and links", () => {
    expect(map.parts.map((p) => p.id)).toEqual(["screens", "core"]);
    expect(map.links).toEqual([{ from: "screens", to: "core", label: "calls" }]);
    expect(readArchMap({})).toBeNull();
  });
  it("puts each file in the closest part", () => {
    expect(partOf("src/App.tsx", map)).toBe("screens");
    expect(partOf("src/components/Other.tsx", map)).toBe("screens");
    expect(partOf("src-tauri/src/pill.rs", map)).toBe("core");
    expect(partOf("README.md", map)).toBeNull();
  });
});
