import { queryOptions } from "@tanstack/react-query";
import { getTweetEmbed } from "@/server/fns";
import {
  readTweetEmbedCacheEntry,
  writeTweetEmbedCache,
  type TweetEmbedCacheStorage,
  type TweetEmbedData,
  type TweetTheme,
} from "@/lib/tweetEmbed";

export const tweetKeys = {
  all: ["tweet"] as const,
  embed: (id: string, theme: TweetTheme) =>
    ["tweet", "embed", id, theme] as const,
};

/** Tweet text never edits in place, so a week stale is still right. */
const TWEET_EMBED_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const TWEET_EMBED_GC_MS = 30 * 24 * 60 * 60 * 1000;

type TweetEmbedFetcher = (args: {
  data: { id: string; theme: TweetTheme };
}) => Promise<TweetEmbedData>;

/**
 * The cached tweet is real query data, not a placeholder. A refresh seeds
 * React Query from localStorage so the card paints with the editor instead
 * of fetching again. The card draws from theme tokens, so the payload is
 * theme-neutral; the theme stays in the key because the block and the
 * prefetch in ContentWorkspace share it, and a toggle costs one refetch.
 */
export const tweetEmbedQuery = (
  id: string,
  theme: TweetTheme,
  fetcher: TweetEmbedFetcher = getTweetEmbed,
  storage?: TweetEmbedCacheStorage,
) => {
  const store =
    storage ??
    (typeof localStorage !== "undefined" ? localStorage : undefined);
  const cached = id ? readTweetEmbedCacheEntry(store, id, theme) : undefined;
  return queryOptions({
    queryKey: tweetKeys.embed(id, theme),
    queryFn: async () => {
      const data = await fetcher({ data: { id, theme } });
      writeTweetEmbedCache(store, id, theme, data);
      return data;
    },
    enabled: Boolean(id),
    staleTime: TWEET_EMBED_STALE_MS,
    gcTime: TWEET_EMBED_GC_MS,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.savedAt,
    placeholderData: (previous) => previous,
  });
};
