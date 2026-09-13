import { createFileRoute } from "@tanstack/react-router";
import { pagesQuery } from "@/queries/content";
import { ContentTrash } from "@/components/content/ContentTrash";

export const Route = createFileRoute("/content/trash")({
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(pagesQuery(deps.q, true)),
  component: () => <ContentTrash />,
});
