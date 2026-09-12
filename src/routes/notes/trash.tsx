import { createFileRoute } from "@tanstack/react-router";

/** Redirected by the parent route. */
export const Route = createFileRoute("/notes/trash")({ component: () => null });
