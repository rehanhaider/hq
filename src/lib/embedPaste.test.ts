import { describe, expect, it } from "vitest";
import {
  isEmptyParagraphContent,
  loneUrlFromPaste,
  pasteTarget,
  planEmbedPaste,
  planEmbedTextInput,
  multiLineInsertion,
  uriListText,
} from "./embedPaste";

const ID = "1234567890123456789";
const TWEET = `https://x.com/alice/status/${ID}`;
const CANONICAL = `https://x.com/i/web/status/${ID}`;
const LINK = "https://example.com/post?id=7";
const REPO = "https://github.com/rehanhaider/hq";
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("uriListText", () => {
  it("drops the comment lines a uri-list payload may carry", () => {
    expect(uriListText(`# comment\n${LINK}\n`)).toBe(`${LINK}\n`);
    expect(loneUrlFromPaste(uriListText(`# comment\n${LINK}\n`))).toBe(LINK);
    expect(uriListText(`  # indented\n${LINK}`)).toBe(LINK);
  });

  it("leaves a payload with no comment lines as it found it", () => {
    expect(uriListText(LINK)).toBe(LINK);
    expect(uriListText(`${LINK}\nhttps://example.org`)).toBe(
      `${LINK}\nhttps://example.org`,
    );
    expect(uriListText("")).toBe("");
  });
});

describe("loneUrlFromPaste", () => {
  it("accepts one http(s) URL with whitespace around it", () => {
    expect(loneUrlFromPaste(`  ${LINK}  `)).toBe(LINK);
    expect(loneUrlFromPaste("http://example.com/#frag")).toBe("http://example.com/");
  });

  it("keeps a hashtag or heading line as a second line, not a comment", () => {
    // Only a uri-list payload has comment lines. In ordinary text the user
    // meant to keep that line, so this is more than a URL.
    expect(loneUrlFromPaste(`${LINK}\n#buildinpublic`)).toBeNull();
    expect(loneUrlFromPaste(`# Heading\n${LINK}`)).toBeNull();
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

  it("leaves a URL followed by a hashtag or heading line to ordinary paste", () => {
    // Both lines are the user's; reducing them to a card would drop one.
    expect(
      planEmbedPaste(`${LINK}\n#hashtag`, { type: "paragraph", empty: true }),
    ).toEqual({ kind: "ignore" });
    expect(
      planEmbedPaste(`${TWEET}\n#hashtag`, { type: "paragraph", empty: true }),
    ).toEqual({ kind: "ignore" });
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

  it("turns every other lone URL into a bookmark, on an empty paragraph only", () => {
    for (const url of [LINK, REPO, VIDEO, "https://x.com/alice"])
      expect(planEmbedTextInput(url, empty)).toEqual({
        kind: "replace",
        type: "bookmark",
        url,
      });
    expect(planEmbedTextInput(REPO, { type: "paragraph", empty: false })).toEqual({
      kind: "ignore",
    });
  });

  it("leaves a URL followed by a hashtag or heading line to ordinary paste", () => {
    // The mobile insertion path reaches `pasteMarkdown` only when the plan
    // ignores the text, so a card here would silently eat the second line.
    expect(planEmbedTextInput("https://example.com\n#hashtag", empty)).toEqual({
      kind: "ignore",
    });
    expect(planEmbedTextInput(`# Heading\n${LINK}`, empty)).toEqual({ kind: "ignore" });
  });

  it("reads trailing whitespace as typing, unless a media matcher claims the URL", () => {
    // A word committed with the space bar; a clipboard or share-sheet
    // insert never carries one.
    expect(planEmbedTextInput(`${LINK} `, empty)).toEqual({ kind: "ignore" });
    expect(planEmbedTextInput("https://example.com ", empty)).toEqual({ kind: "ignore" });
    // A French or iOS layout commits a word with a no-break space. The trim
    // the matchers run first strips those too, so the guard must see them.
    expect(planEmbedTextInput("https://example.com\u00a0", empty)).toEqual({
      kind: "ignore",
    });
    expect(planEmbedTextInput("https://example.com\u202f", empty)).toEqual({
      kind: "ignore",
    });
    expect(planEmbedTextInput(`${TWEET} `, empty)).toEqual({
      kind: "replace",
      type: "tweet",
      url: CANONICAL,
    });
    expect(planEmbedTextInput(`${TWEET}\u00a0`, empty)).toEqual({
      kind: "replace",
      type: "tweet",
      url: CANONICAL,
    });
    // A trailing newline is a form a phone does hand over.
    expect(planEmbedTextInput(`${LINK}\n`, empty)).toEqual({
      kind: "replace",
      type: "bookmark",
      url: LINK,
    });
  });
});

describe("pasteTarget", () => {
  const text = [{ type: "text", text: "hello", styles: {} }];

  it("treats a paragraph with no text as empty, whatever the selection does", () => {
    expect(pasteTarget({ type: "paragraph", content: [] }, false)).toEqual({
      type: "paragraph",
      empty: true,
    });
    expect(pasteTarget({ type: "paragraph", content: [] }, true)).toEqual({
      type: "paragraph",
      empty: true,
    });
  });

  it("treats a paragraph the selection empties as empty, and one that keeps text as not", () => {
    // The whole paragraph is selected, so the embed replaces it.
    expect(pasteTarget({ type: "paragraph", content: text }, true)).toEqual({
      type: "paragraph",
      empty: true,
    });
    // Only part of it is selected, so text survives and the embed goes
    // after the paragraph rather than over it.
    expect(pasteTarget({ type: "paragraph", content: text }, false)).toEqual({
      type: "paragraph",
      empty: false,
    });
  });

  it("never treats another block as empty", () => {
    expect(pasteTarget({ type: "heading", content: [] }, false)).toEqual({
      type: "heading",
      empty: false,
    });
    expect(pasteTarget({ type: "heading", content: [] }, true).empty).toBe(false);
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

describe("multiLineInsertion", () => {
  const tweet = "Top 10 use cases:\n\n1.) Model routing\nSimple → cheap model.";

  it("returns the text of a typed, pasted, or replaced insertion that spans lines", () => {
    expect(multiLineInsertion("insertText", tweet)).toBe(tweet);
    expect(multiLineInsertion("insertFromPaste", tweet)).toBe(tweet);
    expect(multiLineInsertion("insertReplacementText", "one\r\ntwo")).toBe("one\r\ntwo");
    // A tweet URL with a trailing newline counts too; the caller must offer
    // it to `planEmbedTextInput` before pasting it as text.
    expect(multiLineInsertion("insertText", `${TWEET}\n`)).toBe(`${TWEET}\n`);
  });

  it("leaves single-line insertions and other input types to the editor", () => {
    expect(multiLineInsertion("insertText", "one line")).toBeNull();
    expect(multiLineInsertion("insertText", TWEET)).toBeNull();
    expect(multiLineInsertion("insertParagraph", null)).toBeNull();
    expect(multiLineInsertion("insertLineBreak", "\n")).toBeNull();
    expect(multiLineInsertion("deleteContentBackward", tweet)).toBeNull();
    expect(multiLineInsertion("insertText", "")).toBeNull();
    expect(multiLineInsertion("insertText", undefined)).toBeNull();
  });
});
