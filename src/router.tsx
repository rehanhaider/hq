import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QueryClient } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // Preload warms the Query cache via each route's loader. It only helps
    // if the data is still fresh when the click lands, so this must stay in
    // step with the query staleTimes (30s).
    defaultPreloadStaleTime: 30000,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
