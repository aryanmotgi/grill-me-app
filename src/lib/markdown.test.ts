import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/Markdown";

const html = (t: string) => renderToStaticMarkup(createElement(Markdown, { text: t }));

describe("Markdown", () => {
  it("renders code, bold, lists, tables", () => {
    const out = html("Hi **there** `x`\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```");
    expect(out).toContain("<strong");
    expect(out).toContain('class="md-code">x</code>');
    expect(out).toContain("<li>a</li>");
    expect(out).toContain("<td>2</td>");
    expect(out).toContain("const a = 1;");
  });
  it("never injects HTML", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
  it("does not hang on a lone table-looking row", () => {
    expect(html("| just a pipe row |")).toContain("just a pipe row");
  });
});
