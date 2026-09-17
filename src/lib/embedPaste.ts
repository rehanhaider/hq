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
