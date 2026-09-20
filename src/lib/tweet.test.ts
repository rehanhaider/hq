import { describe, expect, it } from "vitest";
import {
  tweetIdsFromDocument,
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
      `https://mobile.x.com/alice/status/${ID}?s=20&t=Kf9_1bQ`,
      `https://x.com/alice/status/${ID}?t=Kf9_1bQ&s=46&ref_src=twsrc%5Etfw`,
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
    expect(tweetStatusUrl(`https://x.com/alice/status/${ID}?s=20 see`)).toBeNull();
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

  it("keeps a tweet body that starts with a share link as ordinary text", () => {
    expect(
      tweetUrlFromPaste(
        `https://x.com/alice/status/${ID}?s=20\nSecond line of the tweet.\nThird line.`,
      ),
    ).toBeNull();
    expect(
      tweetUrlFromPaste(`https://x.com/alice/status/${ID}/\nSecond line of the tweet.`),
    ).toBeNull();
    expect(
      tweetUrlFromPaste(`https://x.com/alice/status/${ID}?s=20\r\nSecond line.`),
    ).toBeNull();
  });
});

describe("tweetIdsFromDocument", () => {
  it("collects unique status ids in document order, including nested blocks", () => {
    expect(
      tweetIdsFromDocument([
        {
          type: "tweet",
          props: { url: `https://x.com/alice/status/${ID}` },
          children: [
            {
              type: "tweet",
              props: { url: "https://twitter.com/bob/status/20" },
            },
          ],
        },
        { type: "paragraph", props: {}, children: [] },
        {
          type: "tweet",
          props: { url: `https://x.com/alice/status/${ID}` },
        },
      ]),
    ).toEqual([ID, "20"]);
  });

  it("ignores missing urls and non-arrays", () => {
    expect(tweetIdsFromDocument(undefined)).toEqual([]);
    expect(
      tweetIdsFromDocument([
        { type: "tweet", props: { url: "https://x.com/alice" } },
      ]),
    ).toEqual([]);
  });
});
