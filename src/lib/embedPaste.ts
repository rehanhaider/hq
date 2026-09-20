import { linkPreviewUrl } from "./linkPreview";
import { tweetUrlFromPaste } from "./tweet";

/**
 * What a paste of nothing but a URL turns into. A tweet URL becomes a
 * tweet block anywhere but a code block. Any other http(s) URL becomes a
 * bookmark card only when it lands on an empty paragraph: a URL pasted
 * into running prose is a link in that prose, not a card after it.
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
 * Clipboard text that is one URL, possibly as a one-line `text/uri-list`.
 * Two or more real lines means the user copied more than a URL.
 */
export function loneUrlFromPaste(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = linkPreviewUrl(trimmed);
  if (direct && !/\s/.test(trimmed)) return direct;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== 1) return null;
  const line = lines[0] ?? "";
  if (/\s/.test(line)) return null;
  return linkPreviewUrl(line);
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

export type EmbedBlockType = "tweet" | "bookmark";

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
  const tweet = tweetUrlFromPaste(clipboardText);
  if (tweet) {
    return empty
      ? { kind: "replace", type: "tweet", url: tweet }
      : { kind: "insert", type: "tweet", url: tweet };
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
 * read and a tweet stays a bare link.
 *
 * Only tweets convert here. A whole tweet URL in one insertion is a
 * clipboard or share-sheet insert, never typing; every other URL keeps the
 * behaviour it has today, where the card comes from a real paste.
 */
export function planEmbedTextInput(
  text: string,
  current: { type: string; empty: boolean } | null,
): EmbedPastePlan {
  if (!tweetUrlFromPaste(text)) return { kind: "ignore" };
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
