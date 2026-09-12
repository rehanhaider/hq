import { createFileRoute } from "@tanstack/react-router";
import { pagesQuery } from "@/queries/content";
import { ContentWorkspace } from "@/components/content/ContentWorkspace";

export const Route = createFileRoute("/content/trash")({
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(pagesQuery(deps.q, true)),
  component: () => <ContentWorkspace trashed />,
});
