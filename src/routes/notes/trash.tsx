import { createFileRoute } from "@tanstack/react-router";
import { notesQuery } from "@/queries/notes";
import { NotesWorkspace } from "@/components/NotesWorkspace";

export const Route = createFileRoute("/notes/trash")({
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(notesQuery(deps.q, true)),
  component: () => <NotesWorkspace trashed />,
});
