import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/Shell";
import "@/lib/breadcrumbs";
import appCss from "../styles/app.css?url";
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    staticData: { crumbs: () => [{ label: "HQ", to: "/", search: {} }] },
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "HQ" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        {
          rel: "icon",
          href: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%23157050%22/%3E%3Ctext x=%226%22 y=%2221%22 font-family=%22monospace%22 font-size=%2216%22 fill=%22white%22%3Ehq%3C/text%3E%3C/svg%3E",
        },
      ],
      scripts: [
        {
          children: `(function(){try{var t=localStorage.getItem('hq:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})();`,
        },
      ],
    }),
    component: () => (
      <html lang="en" data-theme="light" suppressHydrationWarning>
        <head>
          <HeadContent />
        </head>
        <body>
          <Shell />
          <Scripts />
        </body>
      </html>
    ),
    errorComponent: ({ error, reset }) => (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">HQ could not load</h1>
        <p className="my-4 text-muted-foreground">{error.message}</p>
        <Button variant="outline" onClick={reset}>
          Reload
        </Button>
      </main>
    ),
    notFoundComponent: () => (
      <main className="p-8">
        <h1>Page not found</h1>
        <a href="/" className="underline">
          Back to HQ
        </a>
      </main>
    ),
  },
);
