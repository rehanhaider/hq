import { createFileRoute } from "@tanstack/react-router";
import { contentPropertiesQuery, pagesQuery } from "@/queries/content";
import { ContentTrash } from "@/components/content/ContentTrash";

export const Route = createFileRoute("/content/trash")({
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pagesQuery(deps.q, true)),
      context.queryClient.ensureQueryData(contentPropertiesQuery),
    ]),
  component: () => <ContentTrash />,
});
