import { createFileRoute } from "@tanstack/react-router";

/**
 * Every path under the old Notes module, so the parent's redirect can answer
 * for it. Nothing renders here: `beforeLoad` on `/notes` has already thrown.
 */
export const Route = createFileRoute("/notes/$")({ component: () => null });
