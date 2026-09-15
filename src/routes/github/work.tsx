import { createFileRoute } from "@tanstack/react-router";
import { openWorkQuery } from "@/queries/dashboard";
import { OpenWork } from "@/components/OpenWork";

export const Route = createFileRoute("/github/work")({
  // Started, not awaited: the view shows its own placeholder until the
  // sweep lands, which can take tens of seconds on a cold server.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(openWorkQuery);
  },
  component: OpenWork,
});
