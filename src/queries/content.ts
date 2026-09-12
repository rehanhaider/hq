import { queryOptions } from "@tanstack/react-query";
import { getContentProperties, getPage, getPages } from "@/server/fns";

export const contentKeys = {
  all: ["content"] as const,
  lists: ["content", "list"] as const,
  list: (q = "", trashed = false) => ["content", "list", { q, trashed }] as const,
  detail: (id: string) => ["content", "detail", id] as const,
  properties: ["content", "properties"] as const,
};

export const pagesQuery = (q = "", trashed = false) =>
  queryOptions({
    queryKey: contentKeys.list(q, trashed),
    queryFn: () => getPages({ data: { q: q || undefined, trashed } }),
  });

export const pageQuery = (id: string) =>
  queryOptions({
    queryKey: contentKeys.detail(id),
    queryFn: () => getPage({ data: { id } }),
    enabled: Boolean(id),
  });

export const contentPropertiesQuery = queryOptions({
  queryKey: contentKeys.properties,
  queryFn: () => getContentProperties(),
});
