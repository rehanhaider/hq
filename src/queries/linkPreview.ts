import { queryOptions } from "@tanstack/react-query";
import { getLinkPreview } from "@/server/fns";
import {
  readLinkPreviewCacheEntry,
  writeLinkPreviewCache,
  type LinkPreviewCacheStorage,
  type LinkPreviewData,
} from "@/lib/linkPreview";

export const linkPreviewKeys = {
  all: ["link-preview"] as const,
  url: (url: string) => ["link-preview", url] as const,
};

/** A day: a title or image rarely changes, and a refetch is one page load. */
const LINK_PREVIEW_STALE_MS = 24 * 60 * 60 * 1000;
const LINK_PREVIEW_GC_MS = 7 * 24 * 60 * 60 * 1000;

type LinkPreviewFetcher = (args: {
  data: { url: string };
}) => Promise<LinkPreviewData>;

/**
 * The cached preview is real query data, not a placeholder: a refresh
 * seeds React Query from localStorage so the card paints with the editor.
 * A failed fetch is not retried — a page with no tags stays a plain link,
 * and hammering it would not change that.
 */
export const linkPreviewQuery = (
  url: string,
  fetcher: LinkPreviewFetcher = getLinkPreview,
  storage?: LinkPreviewCacheStorage,
) => {
  const store =
    storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  const cached = url ? readLinkPreviewCacheEntry(store, url) : undefined;
  return queryOptions({
    queryKey: linkPreviewKeys.url(url),
    queryFn: async () => {
      const data = await fetcher({ data: { url } });
      writeLinkPreviewCache(store, url, data);
      return data;
    },
    enabled: Boolean(url),
    retry: false,
    staleTime: LINK_PREVIEW_STALE_MS,
    gcTime: LINK_PREVIEW_GC_MS,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
    placeholderData: (previous) => previous,
  });
};
