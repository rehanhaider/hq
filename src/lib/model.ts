import { z } from "zod";
import { monthsBefore } from "./activity";

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date");
export function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
export const searchSchema = z.object({
  from: daySchema.catch(() => monthsBefore(daysAgo(0), 3)),
  to: daySchema.catch(() => daysAgo(0)),
  repo: z.union([z.string(), z.array(z.string())]).catch("all"),
  view: z
    .enum(["overview", "statistics", "projects", "connections", "work"])
    .catch("overview"),
  kind: z.enum(["all", "commit", "pr"]).catch("all"),
  metric: z.enum(["commits", "prs", "lines"]).catch("commits"),
  languages: z.enum(["pie", "table"]).catch("pie"),
  chart: z.enum(["daily", "cumulative"]).catch("daily"),
  page: z.coerce.number().int().min(1).catch(1),
});
export type Filters = z.infer<typeof searchSchema>;
export function defaultFilters(): Filters {
  return {
    from: monthsBefore(daysAgo(0), 3),
    to: daysAgo(0),
    repo: "all",
    view: "overview",
    kind: "all",
    metric: "commits",
    languages: "pie",
    chart: "daily",
    page: 1,
  };
}
export const importSchema = z
  .object({
    repositories: z
      .array(z.string().regex(/^[\w.-]+\/[\w.-]+$/))
      .min(1)
      .max(100),
    since: daySchema,
  })
  .refine(
    (data) => data.since <= daysAgo(0),
    "Import start must be today or earlier",
  );
export type ImportInput = z.infer<typeof importSchema>;
export type Category =
  | "Code"
  | "Tests"
  | "Documentation"
  | "Configuration"
  | "Generated / dependencies"
  | "Other"
  | "Unclassified";
export const categories: Category[] = [
  "Code",
  "Tests",
  "Documentation",
  "Configuration",
  "Generated / dependencies",
  "Other",
  "Unclassified",
];
export type Changes = { additions: number; deletions: number };
export type Repository = {
  id: number;
  fullName: string;
  private: boolean;
  language: string | null;
  defaultBranch: string;
  pushedAt: string | null;
};
export type Commit = Changes & {
  sha: string;
  title: string;
  url: string;
  date: string;
  merge: boolean;
  languages?: Record<string, Changes>;
  categories: Partial<Record<Category, Changes>>;
};
export type PullRequest = Changes & {
  number: number;
  title: string;
  url: string;
  author: string;
  mergedBy: string | null;
  createdAt: string;
  mergedAt: string;
};
export type Snapshot = {
  repo: Repository;
  commits: Commit[];
  prs: PullRequest[];
  since: string;
  until: string;
  importedAt: string;
};
export type ImportStatus = {
  state: "idle" | "running" | "complete" | "error";
  /** Absent on rows written before background refreshes recorded it. */
  mode?: "manual" | "refresh";
  message: string;
  completed: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
};
export type Dataset = {
  login: string | null;
  snapshots: Snapshot[];
  status: ImportStatus;
};
export type RepoSync = {
  fullName: string;
  state: "idle" | "syncing" | "ok" | "error";
  error: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
};
