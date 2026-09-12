import { createFileRoute } from "@tanstack/react-router";
import { noteQuery, notesQuery } from "@/queries/notes";
import { NotesWorkspace } from "@/components/NotesWorkspace";

export const Route = createFileRoute("/notes/")({
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(notesQuery(deps.q));
    if (deps.page) await context.queryClient.ensureQueryData(noteQuery(deps.page));
  },
  component: () => <NotesWorkspace trashed={false} />,
});
