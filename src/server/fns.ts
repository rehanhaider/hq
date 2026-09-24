import { createServerFn } from "@tanstack/react-start";
import { importSchema, searchSchema, daysAgo } from "../lib/model";
import { dailySeries, summarize } from "../lib/metrics";
import { connectionRow } from "../lib/connections";
import { getStore, idleStatus } from "./db";
import type { ImportStatus } from "../lib/model";
import { github } from "./github";
import { openWork } from "./openWork";
import { ensureRefreshLoop, startImport } from "./import";
import { getNasrStore } from "./nasr";
import { getContentStore } from "./content";
import { getUploadStore } from "./uploads";
import {
  NASR_CONTENT,
  dateString,
  nasrDayUpdateSchema,
  getToday,
  resetRequestSchema,
  settingsUpdateSchema,
  windowSummary,
} from "../lib/nasr";
import { z } from "zod";
import { fetchTweetData, type TweetEmbedData } from "../lib/tweetEmbed";
import { fetchLinkPreview } from "./linkPreview";
import { linkPreviewUrl, type LinkPreviewData } from "../lib/linkPreview";
import {
  changePageStateSchema,
  createPageSchema,
  createPropertySchema,
  deletePropertySchema,
  listPagesSchema,
  movePageCardSchema,
  movePageSchema,
  pageIdSchema,
  reorderPropertiesSchema,
  savePageSchema,
  setPagePinnedSchema,
  setPagePropertiesSchema,
  updatePropertySchema,
  contentSummary,
} from "../lib/content";

function nasrSummary() {
  const nasr = getNasrStore();
  const settings = nasr.settings();
  const today = getToday(settings.timezone);
  const days = nasr.days();
  return {
    settings,
    today,
    day: nasr.day(today),
    // Stays whole for the calendar and the day pager. Everything with a
    // denominator is measured over the rolling window: the last 40 days,
    // ending today.
    days,
    ...windowSummary(days, today, settings.istighfar_target),
    content: NASR_CONTENT,
  };
}

export const getHome = createServerFn({ method: "GET" }).handler(() => {
  ensureRefreshLoop();
  const dataset = getStore().dataset();
  const from = daysAgo(6);
  const to = daysAgo(0);
  const week = summarize(dataset, {
    from,
    to,
    repo: "all",
    kind: "all",
    metric: "commits",
    languages: "pie",
    chart: "daily",
    page: 1,
  });
  const content = getContentStore();
  return {
    nasr: nasrSummary(),
    github: {
      login: dataset.login,
      repositories: dataset.snapshots.length,
      // The totals, plus the seven days behind them: a figure with no shape
      // is three numbers and no trend. The rest of `summarize` — history,
      // languages, per-project rows — is not the home page's business.
      week: { ...week.total, days: dailySeries(week.daily, from, to) },
    },
    content: contentSummary(content.list(), content.properties()),
  };
});
export const getNasr = createServerFn({ method: "GET" }).handler(nasrSummary);
export const getNasrDay = createServerFn({ method: "GET" })
  .validator(z.object({ date: dateString }))
  .handler(({ data }) => getNasrStore().day(data.date));
export const updateNasrDay = createServerFn({ method: "POST" })
  .validator(nasrDayUpdateSchema)
  .handler(({ data }) => getNasrStore().upsertDay(data));
export const getNasrSettings = createServerFn({ method: "GET" }).handler(() =>
  getNasrStore().settings(),
);
export const updateNasrSettings = createServerFn({ method: "POST" })
  .validator(settingsUpdateSchema)
  .handler(({ data }) => getNasrStore().updateSettings(data));
export const exportNasr = createServerFn({ method: "GET" })
  .validator(z.object({ format: z.enum(["json", "csv"]).catch("json") }))
  .handler(({ data }) =>
    data.format === "csv"
      ? { format: "csv" as const, body: getNasrStore().exportCsv() }
      : {
          format: "json" as const,
          body: JSON.stringify(getNasrStore().exportJson(), null, 2),
        },
  );
export const resetNasr = createServerFn({ method: "POST" })
  .validator(resetRequestSchema)
  .handler(() => getNasrStore().reset());

export const getPages = createServerFn({ method: "GET" })
  .validator(listPagesSchema)
  .handler(({ data }) => getContentStore().list(data));
export const getPage = createServerFn({ method: "GET" })
  .validator(pageIdSchema)
  .handler(({ data }) => getContentStore().get(data.id));

/**
 * Tweet data, fetched server-side because X sends no CORS headers. Tweets
 * are immutable enough to cache hard: a day in memory per server, a week
 * stale in React Query, a month in localStorage. A deleted tweet or an X
 * outage throws, and the editor falls back to the live widget path.
 */
const tweetEmbedSchema = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  theme: z.enum(["light", "dark"]).catch("dark"),
});
const TWEET_EMBED_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const TWEET_EMBED_MEMORY_LIMIT = 200;
const tweetEmbedMemory = new Map<
  string,
  { data: TweetEmbedData; expires: number }
>();
export const getTweetEmbed = createServerFn({ method: "GET" })
  .validator(tweetEmbedSchema)
  .handler(async ({ data }) => {
    const key = `${data.theme}:${data.id}`;
    const hit = tweetEmbedMemory.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;
    try {
      const fresh = await fetchTweetData(data.id);
      if (tweetEmbedMemory.size >= TWEET_EMBED_MEMORY_LIMIT) {
        const oldest = tweetEmbedMemory.keys().next();
        if (!oldest.done) tweetEmbedMemory.delete(oldest.value);
      }
      tweetEmbedMemory.set(key, {
        data: fresh,
        expires: Date.now() + TWEET_EMBED_MEMORY_TTL_MS,
      });
      return fresh;
    } catch {
      throw new Error("Could not load tweet.");
    }
  });
/**
 * Link preview data for a bookmark block, fetched server-side because the
 * page would not answer the browser. A miss — no tags, an error, a private
 * host — is remembered for an hour so a page of dead links does not refetch
 * on every visit; a hit lives a day.
 */
const linkPreviewSchema = z.object({
  url: z.string().max(2_048).refine((value) => linkPreviewUrl(value) !== null),
});
const LINK_PREVIEW_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_PREVIEW_MISS_TTL_MS = 60 * 60 * 1000;
const LINK_PREVIEW_MEMORY_LIMIT = 500;
const linkPreviewMemory = new Map<
  string,
  { data: LinkPreviewData | null; expires: number }
>();
function rememberLinkPreview(key: string, data: LinkPreviewData | null) {
  if (!linkPreviewMemory.has(key) && linkPreviewMemory.size >= LINK_PREVIEW_MEMORY_LIMIT) {
    const oldest = linkPreviewMemory.keys().next();
    if (!oldest.done) linkPreviewMemory.delete(oldest.value);
  }
  linkPreviewMemory.set(key, {
    data,
    expires:
      Date.now() + (data ? LINK_PREVIEW_MEMORY_TTL_MS : LINK_PREVIEW_MISS_TTL_MS),
  });
}
export const getLinkPreview = createServerFn({ method: "GET" })
  .validator(linkPreviewSchema)
  .handler(async ({ data }) => {
    const key = linkPreviewUrl(data.url) ?? data.url;
    const hit = linkPreviewMemory.get(key);
    if (hit && hit.expires > Date.now()) {
      if (hit.data) return hit.data;
      throw new Error("Could not load a preview for this link.");
    }
    try {
      const fresh = await fetchLinkPreview(key);
      rememberLinkPreview(key, fresh);
      return fresh;
    } catch {
      rememberLinkPreview(key, null);
      throw new Error("Could not load a preview for this link.");
    }
  });
export const getContentProperties = createServerFn({ method: "GET" }).handler(() =>
  getContentStore().properties(),
);
export const createPage = createServerFn({ method: "POST" })
  .validator(createPageSchema)
  .handler(({ data }) =>
    getContentStore().create(
      data.title,
      data.parentId,
      data.document,
      data.statusId,
      data.typeIds,
      data.tagIds,
      data.subpageTypeIds,
    ),
  );
export const setPageProperties = createServerFn({ method: "POST" })
  .validator(setPagePropertiesSchema)
  .handler(({ data }) => getContentStore().setProperties(data));
export const setPagePinned = createServerFn({ method: "POST" })
  .validator(setPagePinnedSchema)
  .handler(({ data }) => getContentStore().setPinned(data));
export const movePageCard = createServerFn({ method: "POST" })
  .validator(movePageCardSchema)
  .handler(({ data }) => getContentStore().moveCard(data));
export const movePage = createServerFn({ method: "POST" })
  .validator(movePageSchema)
  .handler(({ data }) => getContentStore().movePage(data));
export const createContentProperty = createServerFn({ method: "POST" })
  .validator(createPropertySchema)
  .handler(({ data }) =>
    getContentStore().createProperty(data.kind, data.name, data.color),
  );
export const updateContentProperty = createServerFn({ method: "POST" })
  .validator(updatePropertySchema)
  .handler(({ data }) =>
    getContentStore().updateProperty(data.kind, data.id, {
      name: data.name,
      color: data.color,
    }),
  );
export const reorderContentProperties = createServerFn({ method: "POST" })
  .validator(reorderPropertiesSchema)
  .handler(({ data }) => getContentStore().reorderProperties(data.kind, data.ids));
export const deleteContentProperty = createServerFn({ method: "POST" })
  .validator(deletePropertySchema)
  .handler(({ data }) =>
    getContentStore().deleteProperty(data.kind, data.id, data.moveToId),
  );
export const savePage = createServerFn({ method: "POST" })
  .validator(savePageSchema)
  .handler(({ data }) => getContentStore().save(data));
export const trashPage = createServerFn({ method: "POST" })
  .validator(changePageStateSchema)
  .handler(({ data }) => getContentStore().trash(data.id, data.revision));
export const restorePage = createServerFn({ method: "POST" })
  .validator(changePageStateSchema)
  .handler(({ data }) => getContentStore().restore(data.id, data.revision));
/**
 * The only paths that delete a file. Trashing keeps everything a page holds,
 * because a restore has to bring it back whole.
 */
export const deletePageForever = createServerFn({ method: "POST" })
  .validator(changePageStateSchema)
  .handler(({ data }) => {
    const result = getUploadStore().deletePageForever(data.id, data.revision);
    return result.ok ? { ok: true as const } : { ok: false as const, code: result.code };
  });
export const emptyContentTrash = createServerFn({ method: "POST" }).handler(() =>
  getUploadStore().emptyTrash(),
);

export const getConnections = createServerFn({ method: "GET" }).handler(() => {
  ensureRefreshLoop();
  const store = getStore();
  const dataset = store.dataset();
  const sync = store.sync();
  const repositories = dataset.snapshots
    .map((snapshot) =>
      connectionRow(
        {
          ...snapshot,
          prs: snapshot.prs.filter(
            (pr) => pr.author.toLowerCase() === dataset.login?.toLowerCase(),
          ),
        },
        sync[snapshot.repo.fullName],
      ),
    )
    .sort(
      (a, b) =>
        b.metrics.commits.ready - a.metrics.commits.ready ||
        a.fullName.localeCompare(b.fullName),
    );
  return {
    login: dataset.login,
    status: dataset.status,
    repositories,
  };
});
export const getDashboard = createServerFn({ method: "GET" })
  .validator(searchSchema)
  .handler(({ data }) => {
    ensureRefreshLoop();
    const dataset = getStore().dataset();
    return {
      login: dataset.login,
      status: dataset.status,
      repositories: dataset.snapshots.map((s) => s.repo),
      ...summarize(dataset, data),
    };
  });
export const getImportStatus = createServerFn({ method: "GET" }).handler(() => {
  ensureRefreshLoop();
  return getStore().read<ImportStatus>("status") ?? idleStatus;
});
export const getConnection = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const user = await github().user();
      return { connected: true as const, login: user.login };
    } catch (error) {
      return {
        connected: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Could not connect to GitHub.",
      };
    }
  },
);
/**
 * Every open issue and request the token can see, read live from GitHub
 * search rather than the imported snapshots.
 */
export const getOpenWork = createServerFn({ method: "GET" }).handler(() => {
  ensureRefreshLoop();
  return openWork();
});
export const getRepositories = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      return { ok: true as const, repositories: await github().repositories() };
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Could not load repositories.",
      };
    }
  },
);
export const beginImport = createServerFn({ method: "POST" })
  .validator(importSchema)
  .handler(({ data }) => startImport(data));
export const removeConnection = createServerFn({ method: "POST" })
  .validator(z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }))
  .handler(({ data }) => {
    getStore().remove(data.repository);
    return { ok: true as const };
  });
