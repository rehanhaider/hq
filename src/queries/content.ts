import { queryOptions, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { nasrKeys } from "./nasr";
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
    // A sidebar link is preloaded as soon as it renders; this window lets
    // the click reuse that cache. Writes invalidate explicitly.
    staleTime: 30000,
  });

export const pageQuery = (id: string) =>
  queryOptions({
    queryKey: contentKeys.detail(id),
    queryFn: () => getPage({ data: { id } }),
    enabled: Boolean(id),
    staleTime: 30000,
  });

export const contentPropertiesQuery = queryOptions({
  queryKey: contentKeys.properties,
  queryFn: () => getContentProperties(),
  // Properties change rarely and every write invalidates this key.
  staleTime: 60000,
});

/**
 * Content writes change Home's embedded contentSummary. Mark that query
 * stale with the content keys so a 30s home staleTime cannot keep "No
 * pages yet" after a create, or an old title after a rename.
 */
export function invalidateContent(
  queryClient: QueryClient,
  queryKey: readonly unknown[] = contentKeys.lists,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey }),
    queryClient.invalidateQueries({ queryKey: nasrKeys.home }),
  ]);
}

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
      data: { parentId: null },
    });
    queryClient.setQueryData(contentKeys.detail(created.id), created);
    await invalidateContent(queryClient);
    await navigate({ to: "/content", search: { page: created.id } });
  };
}
