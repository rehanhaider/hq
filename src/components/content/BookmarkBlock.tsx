import { useQuery } from "@tanstack/react-query";
import { createReactBlockSpec } from "@blocknote/react";
import { linkPreviewUrl } from "@/lib/linkPreview";
import { linkPreviewQuery } from "@/queries/linkPreview";
import { BookmarkCard } from "./BookmarkCard";

/**
 * A URL pasted on its own line. While the preview loads the block holds a
 * skeleton the card's height; when the page has no tags, or the fetch
 * fails, the block is the link itself, styled like any other.
 */

function BookmarkLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      className="text-primary underline"
      target="_blank"
      rel="noreferrer"
      data-testid="bookmark-fallback"
    >
      {url}
    </a>
  );
}

function BookmarkEmbed({ url }: { url: string }) {
  const href = linkPreviewUrl(url);
  const preview = useQuery(linkPreviewQuery(href ?? ""));

  if (!href) return <span data-testid="bookmark-fallback">{url}</span>;

  if (preview.data) {
    return (
      <div className="bookmark-embed" contentEditable={false} data-testid="bookmark-embed">
        <BookmarkCard preview={preview.data} />
      </div>
    );
  }

  if (preview.isPending) {
    return (
      <div className="bookmark-embed" contentEditable={false} data-testid="bookmark-embed">
        <div
          className="flex flex-col gap-2 rounded-2xl border border-border p-4"
          role="status"
          aria-label="Loading link preview"
        >
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="bookmark-embed" contentEditable={false} data-testid="bookmark-embed">
      <BookmarkLink url={href} />
    </div>
  );
}

function bookmarkFromElement(element: HTMLElement) {
  if (element.getAttribute("data-content-type") !== "bookmark") return undefined;
  const url = linkPreviewUrl(element.getAttribute("data-url") ?? "");
  return url ? { url } : undefined;
}

export const bookmarkBlock = createReactBlockSpec(
  {
    type: "bookmark",
    propSchema: {
      url: { default: "" },
      textAlignment: {
        default: "left" as const,
        values: ["left", "center", "right", "justify"] as const,
      },
    },
    content: "none",
  },
  {
    parse: bookmarkFromElement,
    render: ({ block }) => <BookmarkEmbed url={block.props.url} />,
    toExternalHTML: ({ block }) => (
      <p>
        <a href={block.props.url}>{block.props.url}</a>
      </p>
    ),
  },
);
