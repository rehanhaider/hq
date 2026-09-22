import { linkPreviewUrl } from "./linkPreview";
import { tweetStatusUrl } from "./tweet";

/**
 * What a paste of nothing but a URL turns into. A URL a media matcher
 * recognises becomes that block anywhere but a code block. Any other
 * http(s) URL becomes a bookmark card only when it lands on an empty
 * paragraph: a URL pasted into running prose is a link in that prose, not
 * a card after it.
 */

export function isEmptyParagraphContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every((item) => {
    if (!item || typeof item !== "object") return false;
    const node = item as { type?: unknown; text?: unknown };
    return node.type === "text" && node.text === "";
  });
}

/**
 * The one bare token a pasted or inserted string reduces to, before any
 * matcher looks at it: the text trimmed, or the single real line of a
 * `text/uri-list`. Two or more real lines, or anything with whitespace
 * inside, means the user handed over more than a URL.
 */
function loneToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/\s/.test(trimmed)) return trimmed;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== 1) return null;
  const line = lines[0] ?? "";
  if (/\s/.test(line)) return null;
  return line;
}

/**
 * Clipboard text that is one URL, possibly as a one-line `text/uri-list`.
 * Two or more real lines means the user copied more than a URL.
 */
export function loneUrlFromPaste(text: string): string | null {
  const token = loneToken(text);
  return token ? linkPreviewUrl(token) : null;
}

/**
 * The block a paste lands in, as the planner sees it. A paragraph whose
 * selected text is about to be replaced counts as empty: once the
 * selection goes, a lone URL is all that is left, which is the same
 * gesture as pasting into a blank line.
 */
export function pasteTarget(
  block: { type: string; content?: unknown },
  selectionEmpty: boolean,
): { type: string; empty: boolean } {
  return {
    type: block.type,
    empty:
      block.type === "paragraph" &&
      (!selectionEmpty || isEmptyParagraphContent(block.content)),
  };
}

/**
 * Every block a lone URL can become. One list, shared with the document
 * validator and the editor's block specs, so a card cannot be added in one
 * place and forgotten in another.
 */
export const EMBED_BLOCK_TYPES = ["tweet", "bookmark"] as const;

export type EmbedBlockType = (typeof EMBED_BLOCK_TYPES)[number];

/**
 * The media embeds, in the order a URL is offered to them. A hit wins
 * wherever the caret is — outside a code block — so the block lands even in
 * running prose. Bookmark is not here: it is the fallback for a URL nothing
 * else claimed, and it only ever replaces an empty paragraph.
 */
export const embedMatchers = [
  { type: "tweet", match: tweetStatusUrl },
] as const satisfies readonly {
  type: EmbedBlockType;
  match: (text: string) => string | null;
}[];

/** The first media embed that claims this text, if any. */
function matchEmbed(text: string): { type: EmbedBlockType; url: string } | null {
  const token = loneToken(text);
  if (!token) return null;
  for (const matcher of embedMatchers) {
    const url = matcher.match(token);
    if (url) return { type: matcher.type, url };
  }
  return null;
}

export type EmbedPastePlan =
  | { kind: "ignore" }
  | { kind: "replace"; type: EmbedBlockType; url: string }
  | { kind: "insert"; type: EmbedBlockType; url: string };

export function planEmbedPaste(
  clipboardText: string,
  current: { type: string; empty: boolean } | null,
): EmbedPastePlan {
  if (current?.type === "codeBlock") return { kind: "ignore" };
  const empty = current?.type === "paragraph" && current.empty;
  const media = matchEmbed(clipboardText);
  if (media) {
    return empty
      ? { kind: "replace", type: media.type, url: media.url }
      : { kind: "insert", type: media.type, url: media.url };
  }
  const link = loneUrlFromPaste(clipboardText);
  if (!link || !empty) return { kind: "ignore" };
  return { kind: "replace", type: "bookmark", url: link };
}

/**
 * The same plan for text that arrived without a paste event. Mobile
 * keyboards hand a clipboard URL to the editor as an insertion — Gboard's
 * clipboard chip, the iOS suggestion bar, and a share-sheet insert all go
 * through `beforeinput` rather than `paste` — so the clipboard is never
 * read and the URL stays a bare link.
 *
 * A whole URL in one insertion is a clipboard or share-sheet insert, so it
 * gets the same plan a paste would, with one exception: text that ends in a
 * space no media matcher claims is typing. A word committed with the space
 * bar arrives that way, and a typed URL should stay a link; a clipboard or
 * share-sheet insert never carries a trailing space. A trailing newline is
 * a form a phone does hand over, so it still converts.
 */
export function planEmbedTextInput(
  text: string,
  current: { type: string; empty: boolean } | null,
): EmbedPastePlan {
  if (/ $/.test(text) && !matchEmbed(text)) return { kind: "ignore" };
  return planEmbedPaste(text, current);
}

/**
 * Text that a `beforeinput` insertion carries when it spans more than one
 * line. Chrome splits such an insertion into sibling paragraphs inside the
 * block it lands in, and ProseMirror keeps only the first of them when it
 * reads the DOM back, so everything after the first line break is lost. A
 * mobile keyboard's clipboard chip and share-sheet inserts arrive this way.
 * The caller cancels the event and pastes the text instead.
 *
 * Single-line insertions return null: ProseMirror handles those correctly
 * and `planEmbedTextInput` still sees them.
 */
export function multiLineInsertion(
  inputType: string,
  text: string | null | undefined,
): string | null {
  if (
    inputType !== "insertText" &&
    inputType !== "insertFromPaste" &&
    inputType !== "insertReplacementText"
  )
    return null;
  if (!text || !/[\r\n]/.test(text)) return null;
  return text;
}
