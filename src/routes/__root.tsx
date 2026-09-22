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
        // Dark is the default, so the static value is the dark background.
        // `applyTheme` keeps it honest when the preference says otherwise.
        { name: "theme-color", content: "#0a0b13" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        {
          rel: "icon",
          href: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%23157050%22/%3E%3Ctext x=%226%22 y=%2221%22 font-family=%22monospace%22 font-size=%2216%22 fill=%22white%22%3Ehq%3C/text%3E%3C/svg%3E",
        },
      ],
      scripts: [
        // Runs before the first paint. HQ is dark unless the browser holds a
        // stored preference for light, so a stored value is the only thing
        // that can move it off the theme the server already rendered.
        {
          children: `(function(){try{var t=localStorage.getItem('hq:theme')==='light'?'light':'dark';var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;var m=document.querySelector('meta[name=theme-color]');if(m)m.content=t==='dark'?'#0a0b13':'#f5f5f9'}catch(e){}})();`,
        },
        // Same idea as the theme: the rail is open unless the browser holds
        // a stored collapsed value, and that has to land before the first
        // paint or the rail flashes open on reload. The stylesheet reads
        // this attribute until React hydrates onto the same value.
        {
          children: `(function(){try{document.documentElement.dataset.sidebar=localStorage.getItem('hq:sidebar')==='collapsed'?'collapsed':'open'}catch(e){}})();`,
        },
      ],
    }),
      component: () => (
        <html lang="en" data-theme="dark" data-sidebar="open" suppressHydrationWarning>
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
