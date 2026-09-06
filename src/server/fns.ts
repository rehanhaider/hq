import { createServerFn } from "@tanstack/react-start";
import { importSchema, searchSchema } from "../lib/model";
import { summarize } from "../lib/metrics";
import { getStore, idleStatus } from "./db";
import type { ImportStatus } from "../lib/model";
import { github } from "./github";
import { startImport } from "./import";

export const getDashboard = createServerFn({ method: "GET" })
  .validator(searchSchema)
  .handler(({ data }) => {
    const dataset = getStore().dataset();
    return {
      login: dataset.login,
      status: dataset.status,
      repositories: dataset.snapshots.map((s) => s.repo),
      ...summarize(dataset, data),
    };
  });
export const getImportStatus = createServerFn({ method: "GET" }).handler(
  () => getStore().read<ImportStatus>("status") ?? idleStatus,
);
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
