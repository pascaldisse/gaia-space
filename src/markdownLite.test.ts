import { describe, expect, it } from "bun:test";
import { parseInline, parseMarkdown } from "./markdownLite";

describe("markdownLite", () => {
  it("splits emphasis, bold and code out of a line", () => {
    expect(parseInline("ship **now** or `never`")).toEqual([
      { kind: "text", text: "ship " },
      { kind: "strong", text: "now" },
      { kind: "text", text: " or " },
      { kind: "code", text: "never" },
    ]);
    expect(parseInline("*soon*")).toEqual([{ kind: "em", text: "soon" }]);
  });
  it("never emits markup: angle brackets stay literal text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "text", text: "<img src=x onerror=alert(1)>" },
    ]);
  });
  it("marks bullet lines and strips their marker", () => {
    expect(parseMarkdown("- one\ntwo")).toEqual([
      { bullet: true, tokens: [{ kind: "text", text: "one" }] },
      { bullet: false, tokens: [{ kind: "text", text: "two" }] },
    ]);
  });
});
