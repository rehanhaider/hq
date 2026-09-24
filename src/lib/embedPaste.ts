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
 * Comment lines stripped from a `text/uri-list` payload, which is the one
 * format that defines them (RFC 2483). Only the clipboard's `text/uri-list`
 * flavour goes through here: in ordinary text a line opening with `#` is a
 * hashtag or a markdown heading the user meant to keep.
 */
export function uriListText(data: string): string {
  return data
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * The one bare token a pasted or inserted string reduces to, before any
 * matcher looks at it: the text trimmed, or its single real line. Two or
 * more real lines, or anything with whitespace inside, means the user
 * handed over more than a URL.
 */
function loneToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/\s/.test(trimmed)) return trimmed;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1) return null;
  const line = lines[0] ?? "";
  if (/\s/.test(line)) return null;
  return line;
}

/**
 * Text that is one URL and nothing else. Two or more real lines means the
 * user handed over more than a URL. A `text/uri-list` payload reaches this
 * through `uriListText`, which takes its comment lines off first.
 */
export function loneUrlFromPaste(text: string): string | null {
  const token = loneToken(text);
  return token ? linkPreviewUrl(token) : null;
}

/**
 * The block a paste lands in, as the planner sees it. Empty means a lone
 * URL would be all the paragraph holds, so the embed replaces it rather
 * than going after it.
 *
 * `selectionLeavesEmpty` is the selection's verdict on what survives the
 * deletion that precedes the embed, or null when there is no selection to
 * ask. A verdict decides on its own, because only the selection can see
 * past this block: a selection running from a blank paragraph into the
 * middle of the next one leaves that block's tail behind, and the tail
 * lands here once the two are merged — so the paragraph is not empty,
 * however empty its own content looks. With no verdict, that content is
 * the whole story.
 */
export function pasteTarget(
  block: { type: string; content?: unknown },
  selectionLeavesEmpty: boolean | null,
): { type: string; empty: boolean } {
  return {
    type: block.type,
    empty:
      block.type === "paragraph" &&
      (selectionLeavesEmpty ?? isEmptyParagraphContent(block.content)),
  };
}

/**
 * Every card block a lone URL can become. One list, shared with the
 * document validator and the editor's block specs, so a card cannot be
 * added in one place and forgotten in another.
 */
export const EMBED_BLOCK_TYPES = ["tweet", "bookmark"] as const;

export type EmbedBlockType = (typeof EMBED_BLOCK_TYPES)[number];

/**
 * Every block a pasted URL can become: the embeds above, plus the editor's
 * own image and video blocks for a link straight to such a file. Those two
 * are file blocks, validated as files, so they are not embed types.
 */
export type PasteBlockType = EmbedBlockType | "image" | "video";

const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_EXTENSION = /\.(?:m4v|mov|mp4|ogv|webm)$/i;

/**
 * Paths that name a file but serve an HTML page about it: a GitHub or
 * GitLab file view, and a wiki's file description page. The file itself
 * lives elsewhere, so these stay bookmark cards.
 */
const VIEWER_PATH = /\/blob\/|\/wiki\/(?:File|Image):/i;

/**
 * A URL whose path names a file of the given kind. The extension is the
 * test, since the paste has to be decided before anything could be
 * fetched, and a link that names a `.jpg` is one the user expects to see
 * as a picture — unless the path is a known viewer page for that file.
 */
function fileUrl(extension: RegExp): (text: string) => string | null {
  return (text) => {
    const url = linkPreviewUrl(text);
    if (!url) return null;
    const { pathname } = new URL(url);
    return extension.test(pathname) && !VIEWER_PATH.test(pathname) ? url : null;
  };
}

export const imageFileUrl = fileUrl(IMAGE_EXTENSION);
export const videoFileUrl = fileUrl(VIDEO_EXTENSION);

/**
 * The media embeds, in the order a URL is offered to them. A hit wins
 * wherever the caret is — outside a code block — so the block lands even in
 * running prose. Bookmark is not here: it is the fallback for a URL nothing
 * else claimed, and it only ever replaces an empty paragraph.
 */
export const embedMatchers = [
  { type: "tweet", match: tweetStatusUrl },
  { type: "image", match: imageFileUrl },
  { type: "video", match: videoFileUrl },
] as const satisfies readonly {
  type: PasteBlockType;
  match: (text: string) => string | null;
}[];

/** The first media embed that claims this text, if any. */
function matchEmbed(text: string): { type: PasteBlockType; url: string } | null {
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
  | { kind: "replace"; type: PasteBlockType; url: string }
  | { kind: "insert"; type: PasteBlockType; url: string };

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
 * gets the same plan a paste would, with one exception: text that ends in
 * whitespace no media matcher claims is typing. A word committed with the
 * space bar arrives that way, and a typed URL should stay a link; a
 * clipboard or share-sheet insert never carries trailing whitespace. Any
 * trailing whitespace counts, not the plain space alone, because the
 * no-break spaces a French or iOS layout commits a word with are whitespace
 * to the trim the matchers run first. A trailing newline is a form a phone
 * does hand over, so it is the one exception and still converts.
 */
export function planEmbedTextInput(
  text: string,
  current: { type: string; empty: boolean } | null,
): EmbedPastePlan {
  if (/[^\S\r\n]$/.test(text) && !matchEmbed(text)) return { kind: "ignore" };
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
