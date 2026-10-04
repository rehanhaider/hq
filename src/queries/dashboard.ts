import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { Filters } from "@/lib/model";
import {
  getConnection,
  getConnections,
  getDashboard,
  getImportStatus,
  getOpenWork,
  getOpenWorkSummary,
  getRepositories,
} from "@/server/fns";

export const dashboardQuery = (filters: Filters) =>
  queryOptions({
    queryKey: ["dashboard", filters],
    placeholderData: keepPreviousData,
    queryFn: () => getDashboard({ data: filters }),
    staleTime: 15000,
  });
export const connectionQuery = queryOptions({
  queryKey: ["connection"],
  queryFn: () => getConnection(),
  staleTime: 60000,
});
export const repositoriesQuery = queryOptions({
  queryKey: ["repositories"],
  queryFn: () => getRepositories(),
  staleTime: 60000,
});
export const connectionsQuery = queryOptions({
  queryKey: ["connections"],
  queryFn: () => getConnections(),
  staleTime: 5000,
});
export const openWorkQuery = queryOptions({
  queryKey: ["open-work"],
  queryFn: () => getOpenWork(),
  staleTime: 60000,
});
/** The Home card's slice of the feed, kept apart so it stays small. */
export const openWorkSummaryQuery = queryOptions({
  queryKey: ["open-work", "summary"],
  queryFn: () => getOpenWorkSummary(),
  staleTime: 60000,
});
export const statusQuery = queryOptions({
  queryKey: ["import-status"],
  queryFn: () => getImportStatus(),
  refetchInterval: (query) =>
    query.state.data?.state === "running" ? 1500 : 10000,
});
