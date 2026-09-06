import { queryOptions } from "@tanstack/react-query";
import type { Filters } from "@/lib/model";
import {
  getConnection,
  getDashboard,
  getImportStatus,
  getRepositories,
} from "@/server/fns";

export const dashboardQuery = (filters: Filters) =>
  queryOptions({
    queryKey: ["dashboard", filters],
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
export const statusQuery = queryOptions({
  queryKey: ["import-status"],
  queryFn: () => getImportStatus(),
  refetchInterval: (query) =>
    query.state.data?.state === "running" ? 1500 : 10000,
});
