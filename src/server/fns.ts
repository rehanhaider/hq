import { createServerFn } from "@tanstack/react-start";
import { importSchema, searchSchema, daysAgo } from "../lib/model";
import { dailySeries, summarize } from "../lib/metrics";
import { connectionRow } from "../lib/connections";
import { getStore, idleStatus } from "./db";
import type { ImportStatus } from "../lib/model";
import { github } from "./github";
import { loadOpenWork } from "./openWork";
import { ensureRefreshLoop, startImport } from "./import";
import { getDeenStore } from "./deen";
import { getContentStore } from "./content";
import { getUploadStore } from "./uploads";
import {
  DEEN_CONTENT,
  calculateAdherence,
  dateString,
  daysInWindow,
  deenDayUpdateSchema,
  fajrOnTimeStreak,
  getToday,
  overallAdherence,
  resetRequestSchema,
  settingsUpdateSchema,
} from "../lib/deen";
import { z } from "zod";
import {
  changePageStateSchema,
  createPageSchema,
  createPropertySchema,
  deletePropertySchema,
  listPagesSchema,
  movePageCardSchema,
  pageIdSchema,
  reorderPropertiesSchema,
  savePageSchema,
  setPagePropertiesSchema,
  updatePropertySchema,
  contentSummary,
} from "../lib/content";

function deenSummary() {
  const deen = getDeenStore();
  const settings = deen.settings();
  const today = getToday(settings.timezone);
  const days = deen.days();
  // Everything with a denominator is measured over the rolling window: the
  // last 40 days, ending today. `days` stays whole for the calendar and the
  // day pager.
  const windowed = daysInWindow(days, today);
  // Fewer than 40 days logged scores against the days that exist, so a week
  // of records is not read as a week out of forty.
  const windowDays = windowed.length;
  return {
    settings,
    today,
    day: deen.day(today),
    days,
    // How much of the window is actually logged, so the pages can tell an
    // empty window apart from an empty history rather than inferring it from
    // zeroes.
    windowDays,
    // Deliberately not windowed. A streak has no denominator, so it never had
    // the mismatch the window exists to fix, and it runs to today.
    fajrStreak: fajrOnTimeStreak(days, today),
    adherence: calculateAdherence(
      windowed,
      windowDays,
      settings.istighfar_target,
    ),
    overall: overallAdherence(windowed, windowDays, settings.istighfar_target),
    content: DEEN_CONTENT,
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
    view: "overview",
    kind: "all",
    metric: "commits",
    languages: "pie",
    chart: "daily",
    page: 1,
  });
  const content = getContentStore();
  return {
    deen: deenSummary(),
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
export const getDeen = createServerFn({ method: "GET" }).handler(deenSummary);
export const getDeenDay = createServerFn({ method: "GET" })
  .validator(z.object({ date: dateString }))
  .handler(({ data }) => getDeenStore().day(data.date));
export const updateDeenDay = createServerFn({ method: "POST" })
  .validator(deenDayUpdateSchema)
  .handler(({ data }) => getDeenStore().upsertDay(data));
export const getDeenSettings = createServerFn({ method: "GET" }).handler(() =>
  getDeenStore().settings(),
);
export const updateDeenSettings = createServerFn({ method: "POST" })
  .validator(settingsUpdateSchema)
  .handler(({ data }) => getDeenStore().updateSettings(data));
export const exportDeen = createServerFn({ method: "GET" })
  .validator(z.object({ format: z.enum(["json", "csv"]).catch("json") }))
  .handler(({ data }) =>
    data.format === "csv"
      ? { format: "csv" as const, body: getDeenStore().exportCsv() }
      : {
          format: "json" as const,
          body: JSON.stringify(getDeenStore().exportJson(), null, 2),
        },
  );
export const resetDeen = createServerFn({ method: "POST" })
  .validator(resetRequestSchema)
  .handler(() => getDeenStore().reset());

export const getPages = createServerFn({ method: "GET" })
  .validator(listPagesSchema)
  .handler(({ data }) => getContentStore().list(data));
export const getPage = createServerFn({ method: "GET" })
  .validator(pageIdSchema)
  .handler(({ data }) => getContentStore().get(data.id));
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
      data.typeId,
      data.tagIds,
    ),
  );
export const setPageProperties = createServerFn({ method: "POST" })
  .validator(setPagePropertiesSchema)
  .handler(({ data }) => getContentStore().setProperties(data));
export const movePageCard = createServerFn({ method: "POST" })
  .validator(movePageCardSchema)
  .handler(({ data }) => getContentStore().moveCard(data));
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
export const getOpenWork = createServerFn({ method: "GET" }).handler(() =>
  loadOpenWork(),
);
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
