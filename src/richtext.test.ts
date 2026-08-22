import { describe, expect, it } from "bun:test";
import { applyMarkdownCommand, sanitizeRichHtml } from "./richtext";

describe("sanitizeRichHtml", () => {
  it("keeps allowlisted formatting", () => {
    expect(sanitizeRichHtml("<p><strong>a</strong> <em>b</em></p>")).toBe("<p><strong>a</strong> <em>b</em></p>");
  });
  it("drops script elements with their content", () => {
    expect(sanitizeRichHtml("<p>ok</p><script>alert(1)</script>")).toBe("<p>ok</p>");
  });
  it("strips event handlers and style attributes but keeps the element", () => {
    expect(sanitizeRichHtml('<p onclick="steal()" style="color:red">hi</p>')).toBe("<p>hi</p>");
  });
  it("unwraps unknown tags, keeping their text", () => {
    expect(sanitizeRichHtml("<marquee>text</marquee>")).toBe("text");
  });
  it("keeps http links and rejects javascript: urls", () => {
    expect(sanitizeRichHtml('<a href="https://x.dev">x</a>')).toBe('<a href="https://x.dev">x</a>');
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichHtml('<a href="java\nscript:alert(1)">x</a>')).toBe("<a>x</a>");
  });
  it("is idempotent", () => {
    const once = sanitizeRichHtml('<div><img src=x onerror=alert(1)><b>b</b></div>');
    expect(sanitizeRichHtml(once)).toBe(once);
  });
});

describe("applyMarkdownCommand", () => {
  it("wraps a selection and keeps it selected", () => {
    const r = applyMarkdownCommand("hello world", { start: 6, end: 11 }, "bold");
    expect(r.body).toBe("hello **world**");
    expect("hello **world**".slice(r.start, r.end)).toBe("world");
  });
  it("toggles an existing wrap off", () => {
    const r = applyMarkdownCommand("hello **world**", { start: 8, end: 13 }, "bold");
    expect(r.body).toBe("hello world");
  });
  it("prefixes whole lines for headings and toggles them back", () => {
    const on = applyMarkdownCommand("title", { start: 0, end: 0 }, "h2");
    expect(on.body).toBe("## title");
    expect(applyMarkdownCommand(on.body, { start: 0, end: 0 }, "h2").body).toBe("title");
  });
  it("numbers a multi-line selection for ordered lists", () => {
    const r = applyMarkdownCommand("a\nb", { start: 0, end: 3 }, "ol");
    expect(r.body).toBe("1. a\n2. b");
  });
  it("bullets a multi-line selection", () => {
    expect(applyMarkdownCommand("a\nb", { start: 0, end: 3 }, "ul").body).toBe("- a\n- b");
  });
  it("inserts a link and selects the url placeholder", () => {
    const r = applyMarkdownCommand("see ", { start: 4, end: 4 }, "link");
    expect(r.body).toBe("see [link text](https://)");
    expect(r.body.slice(r.start, r.end)).toBe("https://");
  });
});
