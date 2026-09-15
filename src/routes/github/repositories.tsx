import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { connectionsQuery, statusQuery } from "@/queries/dashboard";
import { Connections } from "@/components/Connections";

export const Route = createFileRoute("/github/repositories")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(connectionsQuery),
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const status = useQuery(statusQuery);
  return <Connections importing={status.data?.state === "running"} />;
}
