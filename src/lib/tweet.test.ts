import { describe, expect, it } from "vitest";
import {
  isEmptyParagraphContent,
  planTweetPaste,
  tweetStatusId,
  tweetStatusUrl,
  tweetUrlFromPaste,
} from "./tweet";

const ID = "1234567890123456789";
const CANONICAL = `https://x.com/i/web/status/${ID}`;

describe("tweetStatusUrl", () => {
  it("accepts x.com and twitter.com status URLs, including mobile and www", () => {
    for (const href of [
      `https://x.com/alice/status/${ID}`,
      `https://twitter.com/alice/status/${ID}`,
      `https://www.x.com/alice/status/${ID}?s=20`,
      `http://mobile.twitter.com/alice/statuses/${ID}/photo/1`,
      `https://x.com/i/web/status/${ID}`,
      `https://x.com/i/status/${ID}`,
    ]) {
      expect(tweetStatusUrl(href)).toBe(CANONICAL);
      expect(tweetStatusId(href)).toBe(ID);
    }
  });

  it("rejects profiles, other hosts, extra text, and unsafe URLs", () => {
    expect(tweetStatusUrl("https://x.com/alice")).toBeNull();
    expect(tweetStatusUrl("https://x.com/home")).toBeNull();
    expect(tweetStatusUrl(`https://example.com/alice/status/${ID}`)).toBeNull();
    expect(tweetStatusUrl(`https://not-x.com/alice/status/${ID}`)).toBeNull();
    expect(tweetStatusUrl(`https://user:pass@x.com/alice/status/${ID}`)).toBeNull();
    expect(tweetStatusUrl(`javascript:https://x.com/alice/status/${ID}`)).toBeNull();
    expect(tweetStatusUrl(`see https://x.com/alice/status/${ID}`)).toBeNull();
    expect(tweetStatusUrl("")).toBeNull();
  });
});

describe("tweetUrlFromPaste", () => {
  it("treats a lone URL, with surrounding whitespace or a uri-list line, as a tweet", () => {
    expect(tweetUrlFromPaste(`  https://x.com/alice/status/${ID}  `)).toBe(CANONICAL);
    expect(tweetUrlFromPaste(`# comment\nhttps://twitter.com/alice/status/${ID}\n`)).toBe(
      CANONICAL,
    );
  });

  it("leaves mixed clipboard content alone", () => {
    expect(
      tweetUrlFromPaste(`Look at this\nhttps://x.com/alice/status/${ID}`),
    ).toBeNull();
    expect(tweetUrlFromPaste("https://example.com")).toBeNull();
  });
});

describe("planTweetPaste", () => {
  const url = `https://x.com/alice/status/${ID}`;

  it("replaces an empty paragraph and inserts after other blocks", () => {
    expect(planTweetPaste(url, { type: "paragraph", empty: true })).toEqual({
      kind: "replace",
      url: CANONICAL,
    });
    expect(planTweetPaste(url, { type: "paragraph", empty: false })).toEqual({
      kind: "insert",
      url: CANONICAL,
    });
    expect(planTweetPaste(url, { type: "heading", empty: true })).toEqual({
      kind: "insert",
      url: CANONICAL,
    });
  });

  it("does not intercept code blocks or non-tweet pastes", () => {
    expect(planTweetPaste(url, { type: "codeBlock", empty: true })).toEqual({
      kind: "ignore",
    });
    expect(planTweetPaste("https://example.com", { type: "paragraph", empty: true })).toEqual({
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
          href: `https://x.com/alice/status/${ID}`,
          content: [{ type: "text", text: "tweet", styles: {} }],
        },
      ]),
    ).toBe(false);
  });
});
