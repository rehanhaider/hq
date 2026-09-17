import { describe, expect, it } from "vitest";
import {
  isEmptyParagraphContent,
  loneUrlFromPaste,
  planEmbedPaste,
} from "./embedPaste";

const ID = "1234567890123456789";
const TWEET = `https://x.com/alice/status/${ID}`;
const CANONICAL = `https://x.com/i/web/status/${ID}`;
const LINK = "https://example.com/post?id=7";

describe("loneUrlFromPaste", () => {
  it("accepts one http(s) URL, with whitespace or a uri-list comment around it", () => {
    expect(loneUrlFromPaste(`  ${LINK}  `)).toBe(LINK);
    expect(loneUrlFromPaste(`# comment\n${LINK}\n`)).toBe(LINK);
    expect(loneUrlFromPaste("http://example.com/#frag")).toBe("http://example.com/");
  });

  it("leaves prose, several lines, and other schemes alone", () => {
    expect(loneUrlFromPaste(`Look at ${LINK}`)).toBeNull();
    expect(loneUrlFromPaste(`${LINK}\nhttps://example.org`)).toBeNull();
    expect(loneUrlFromPaste("mailto:someone@example.com")).toBeNull();
    expect(loneUrlFromPaste("javascript:alert(1)")).toBeNull();
    expect(loneUrlFromPaste("example.com")).toBeNull();
    expect(loneUrlFromPaste("")).toBeNull();
  });
});

describe("planEmbedPaste", () => {
  it("turns a tweet URL into a tweet block, replacing an empty paragraph", () => {
    expect(planEmbedPaste(TWEET, { type: "paragraph", empty: true })).toEqual({
      kind: "replace",
      type: "tweet",
      url: CANONICAL,
    });
    expect(planEmbedPaste(TWEET, { type: "paragraph", empty: false })).toEqual({
      kind: "insert",
      type: "tweet",
      url: CANONICAL,
    });
    expect(planEmbedPaste(TWEET, { type: "heading", empty: true })).toEqual({
      kind: "insert",
      type: "tweet",
      url: CANONICAL,
    });
  });

  it("turns any other lone URL into a bookmark only on an empty paragraph", () => {
    expect(planEmbedPaste(LINK, { type: "paragraph", empty: true })).toEqual({
      kind: "replace",
      type: "bookmark",
      url: LINK,
    });
    expect(planEmbedPaste(LINK, { type: "paragraph", empty: false })).toEqual({
      kind: "ignore",
    });
    expect(planEmbedPaste(LINK, { type: "heading", empty: true })).toEqual({
      kind: "ignore",
    });
    expect(planEmbedPaste(LINK, null)).toEqual({ kind: "ignore" });
  });

  it("does not intercept code blocks or ordinary text", () => {
    expect(planEmbedPaste(TWEET, { type: "codeBlock", empty: true })).toEqual({
      kind: "ignore",
    });
    expect(planEmbedPaste(LINK, { type: "codeBlock", empty: true })).toEqual({
      kind: "ignore",
    });
    expect(planEmbedPaste("hello world", { type: "paragraph", empty: true })).toEqual({
      kind: "ignore",
    });
  });
});

describe("isEmptyParagraphContent", () => {
  it("treats no nodes, or only empty text nodes, as empty", () => {
    expect(isEmptyParagraphContent([])).toBe(true);
    expect(isEmptyParagraphContent([{ type: "text", text: "", styles: {} }])).toBe(true);
    expect(isEmptyParagraphContent([{ type: "text", text: "hi", styles: {} }])).toBe(false);
    expect(
      isEmptyParagraphContent([
        {
          type: "link",
          href: TWEET,
          content: [{ type: "text", text: "tweet", styles: {} }],
        },
      ]),
    ).toBe(false);
  });
});
