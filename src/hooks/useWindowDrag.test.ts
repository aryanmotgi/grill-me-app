import { describe, expect, it } from "vitest";
import { dragsWindow } from "./useWindowDrag";

// a tiny stand-in for an element: its own tag/attrs plus its ancestors
type Node = { tag: string; attrs?: Record<string, string>; parent?: Node };
function el(n: Node): Element {
  const matches = (x: Node, sel: string) => sel.split(",").map((s) => s.trim()).some((s) => {
    const attr = /^\[([\w-]+)(?:='([^']*)')?\]$/.exec(s);
    if (attr) return x.attrs?.[attr[1]] !== undefined && (attr[2] === undefined || x.attrs[attr[1]] === attr[2]);
    const tagAttr = /^(\w+)\[([\w-]+)\]$/.exec(s);
    if (tagAttr) return x.tag === tagAttr[1] && x.attrs?.[tagAttr[2]] !== undefined;
    return x.tag === s;
  });
  return { closest: (sel: string) => { for (let x: Node | undefined = n; x; x = x.parent) if (matches(x, sel)) return x; return null; } } as unknown as Element;
}

const bar: Node = { tag: "header", attrs: { "data-drag-zone": "" } };
const button: Node = { tag: "button", parent: bar };

describe("dragsWindow", () => {
  it("drags from bare bar and its text", () => {
    expect(dragsWindow(el(bar))).toBe(true);
    expect(dragsWindow(el({ tag: "span", parent: bar }))).toBe(true);
  });
  it("never steals a press on something you can click or type in", () => {
    expect(dragsWindow(el(button))).toBe(false);
    expect(dragsWindow(el({ tag: "svg", parent: button }))).toBe(false);
    expect(dragsWindow(el({ tag: "input", parent: bar }))).toBe(false);
    expect(dragsWindow(el({ tag: "span", parent: { tag: "div", attrs: { "data-no-drag": "" }, parent: bar } }))).toBe(false);
    expect(dragsWindow(el({ tag: "div", attrs: { role: "tab" }, parent: bar }))).toBe(false);
  });
  it("only inside a drag zone", () => {
    expect(dragsWindow(el({ tag: "span", parent: { tag: "main" } }))).toBe(false);
    expect(dragsWindow(null)).toBe(false);
  });
});
