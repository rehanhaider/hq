import { createFileRoute } from "@tanstack/react-router";
import { contentPropertiesQuery, pagesQuery } from "@/queries/content";
import { ContentSettings } from "@/components/content/ContentSettings";

export const Route = createFileRoute("/content/settings")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(contentPropertiesQuery),
      context.queryClient.ensureQueryData(pagesQuery()),
    ]),
  component: ContentSettings,
});
