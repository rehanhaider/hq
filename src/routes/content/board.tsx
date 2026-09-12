import { createFileRoute } from "@tanstack/react-router";
import { contentPropertiesQuery, pagesQuery } from "@/queries/content";
import { ContentBoard } from "@/components/content/ContentBoard";

export const Route = createFileRoute("/content/board")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pagesQuery()),
      context.queryClient.ensureQueryData(contentPropertiesQuery),
    ]),
  component: ContentBoard,
});
