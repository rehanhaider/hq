import { createFileRoute } from "@tanstack/react-router";
import { contentPropertiesQuery, pageQuery, pagesQuery } from "@/queries/content";
import { ContentWorkspace } from "@/components/content/ContentWorkspace";

export const Route = createFileRoute("/content/")({
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(pagesQuery(deps.q)),
      context.queryClient.ensureQueryData(contentPropertiesQuery),
    ]);
    if (deps.page) await context.queryClient.ensureQueryData(pageQuery(deps.page));
  },
  component: () => <ContentWorkspace trashed={false} />,
});
