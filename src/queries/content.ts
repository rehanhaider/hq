import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createPage, getContentProperties, getPage, getPages } from "@/server/fns";

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

/**
 * Starts a page and opens it. The top bar and the homepage both create pages
 * from outside Content, so the call sits beside the queries it has to
 * invalidate rather than being copied into each of them.
 */
export function useNewPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    const created = await createPage({
      data: { title: "Untitled", parentId: null },
    });
    queryClient.setQueryData(contentKeys.detail(created.id), created);
    await queryClient.invalidateQueries({ queryKey: contentKeys.lists });
    await navigate({ to: "/content", search: { page: created.id } });
  };
}
