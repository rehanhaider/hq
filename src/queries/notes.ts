import { queryOptions } from "@tanstack/react-query";
import { getNote, getNotes } from "@/server/fns";

export const noteKeys = {
  all: ["notes"] as const,
  list: (q = "", trashed = false) => ["notes", "list", { q, trashed }] as const,
  detail: (id: string) => ["notes", "detail", id] as const,
};

export const notesQuery = (q = "", trashed = false) =>
  queryOptions({
    queryKey: noteKeys.list(q, trashed),
    queryFn: () => getNotes({ data: { q: q || undefined, trashed } }),
  });

export const noteQuery = (id: string) =>
  queryOptions({
    queryKey: noteKeys.detail(id),
    queryFn: () => getNote({ data: { id } }),
    enabled: Boolean(id),
  });
