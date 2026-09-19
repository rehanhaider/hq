import { describe, expect, it } from "vitest";
import {
  isEmptyParagraphContent,
  loneUrlFromPaste,
  pasteTarget,
  planEmbedPaste,
  planEmbedTextInput,
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

describe("planEmbedTextInput", () => {
  const empty = { type: "paragraph", empty: true };

  it("converts a tweet URL inserted without a paste event", () => {
    expect(planEmbedTextInput(TWEET, empty)).toEqual({
      kind: "replace",
      type: "tweet",
      url: CANONICAL,
    });
    expect(planEmbedTextInput(TWEET, { type: "paragraph", empty: false })).toEqual({
      kind: "insert",
      type: "tweet",
      url: CANONICAL,
    });
  });

  it("converts the URL forms a phone hands over", () => {
    for (const inserted of [
      `https://x.com/alice/status/${ID}?s=20&t=Kf9_1bQ`,
      `https://twitter.com/alice/status/${ID}?s=46`,
      `https://mobile.twitter.com/alice/status/${ID}`,
      `https://mobile.x.com/alice/status/${ID}`,
      `https://www.x.com/alice/status/${ID}/photo/1`,
      `https://x.com/alice/status/${ID}\n`,
      `  https://x.com/alice/status/${ID} `,
    ])
      expect(planEmbedTextInput(inserted, empty)).toEqual({
        kind: "replace",
        type: "tweet",
        url: CANONICAL,
      });
  });

  it("leaves typing, prose, and code blocks alone", () => {
    expect(planEmbedTextInput("h", empty)).toEqual({ kind: "ignore" });
    expect(planEmbedTextInput(`Look at ${TWEET}`, empty)).toEqual({ kind: "ignore" });
    expect(planEmbedTextInput(TWEET, { type: "codeBlock", empty: true })).toEqual({
      kind: "ignore",
    });
  });

  it("leaves every other URL to the paste path", () => {
    expect(planEmbedTextInput(LINK, empty)).toEqual({ kind: "ignore" });
    expect(planEmbedTextInput("https://x.com/alice", empty)).toEqual({ kind: "ignore" });
  });
});

describe("pasteTarget", () => {
  const text = [{ type: "text", text: "hello", styles: {} }];

  it("treats a paragraph as empty when it has no text or its selection is about to go", () => {
    expect(pasteTarget({ type: "paragraph", content: [] }, true)).toEqual({
      type: "paragraph",
      empty: true,
    });
    expect(pasteTarget({ type: "paragraph", content: text }, true)).toEqual({
      type: "paragraph",
      empty: false,
    });
    expect(pasteTarget({ type: "paragraph", content: text }, false)).toEqual({
      type: "paragraph",
      empty: true,
    });
  });

  it("never treats another block as empty", () => {
    expect(pasteTarget({ type: "heading", content: [] }, false)).toEqual({
      type: "heading",
      empty: false,
    });
    expect(pasteTarget({ type: "codeBlock", content: [] }, true).empty).toBe(false);
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
