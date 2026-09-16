import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  BookOpen,
  FilePlus2,
  FolderGit2,
  House,
  Moon,
  Sun,
  PanelLeftOpen,
  PanelLeftClose,
  NotebookPen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useUI } from "@/store/ui";
import { defaultFilters } from "@/lib/model";
import { statusQuery } from "@/queries/dashboard";
import { useNewPage } from "@/queries/content";

// Layout effects do nothing on the server, so this alias keeps server
// rendering quiet while the client still syncs before paint.
const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;

export function Shell() {
  const { pathname } = useLocation();
  const drawer = useRef<HTMLElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const wasMobileOpen = useRef(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (mobileOpen)
      drawer.current
        ?.querySelector<HTMLButtonElement>('button[aria-label="Close sidebar"]')
        ?.focus();
    else if (wasMobileOpen.current) mobileTrigger.current?.focus();
    wasMobileOpen.current = mobileOpen;
  }, [mobileOpen]);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 768px)");
    const close = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  const navClass =
    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground md:min-h-9";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const expanded = sidebarOpen;
  // Stable hook for the first-paint stylesheet, which hides these labels
  // when the blocking script found a stored collapsed rail.
  const labelClass = `sidebar-label ${
    mobileOpen
      ? "truncate"
      : expanded
        ? "sr-only md:not-sr-only md:truncate"
        : "sr-only"
  }`;
  // Runs before paint on the client, after the blocking script already set
  // data-sidebar. The first render matches the server (open), the
  // stylesheet holds the collapsed geometry meanwhile, and this corrects
  // state with no visible flash and no hydration mismatch.
  useIsomorphicLayoutEffect(() => {
    try {
      const collapsed = localStorage.getItem("hq:sidebar") === "collapsed";
      document.documentElement.dataset.sidebar = collapsed
        ? "collapsed"
        : "open";
      if (collapsed) setSidebarOpen(false);
    } catch {}
  }, []);
  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    // Outside the try: when storage throws, state and attribute must still
    // agree, or the first-paint rules would pin the rail shut. Matches
    // applyTheme in the ui store.
    document.documentElement.dataset.sidebar = next ? "open" : "collapsed";
    try {
      localStorage.setItem("hq:sidebar", next ? "open" : "collapsed");
    } catch {}
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = Boolean(
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], .bn-container',
        ),
      );
      if (editing || event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [sidebarOpen]);
  const ui = useUI();
  const newPage = useNewPage();
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const status = useQuery(statusQuery);
  const previousStatus = useRef<string | null>(null);
  useEffect(() => {
    ui.hydrate();
  }, [ui.hydrate]);
  useEffect(() => {
    // The editor is React.lazy behind the Content route, so a router preload
    // fetches the small route chunk but not the ~800K BlockNote bundle.
    void import("@/components/content/ContentEditor");
  }, []);
  useEffect(() => {
    if (!status.data) return;
    const next = JSON.stringify([
      status.data.state,
      status.data.completed,
      status.data.finishedAt,
    ]);
    const changed =
      previousStatus.current !== null && previousStatus.current !== next;
    previousStatus.current = next;
    if (changed) {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    }
  }, [
    status.data?.state,
    status.data?.completed,
    status.data?.finishedAt,
    queryClient,
  ]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={drawer}
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r bg-sidebar transition-[width,transform] duration-150 motion-reduce:transition-none ${mobileOpen ? "visible translate-x-0 shadow-lg" : "invisible -translate-x-full"} md:visible md:translate-x-0 ${expanded ? "md:w-64" : "md:w-14"}`}
        aria-label="Sidebar"
        onKeyDown={(event) => {
          if (!mobileOpen || event.key !== "Tab") return;
          const items = drawer.current?.querySelectorAll<HTMLElement>(
            "a, button:not([disabled])",
          );
          const visible = [...(items ?? [])].filter(
            (node) => node.getClientRects().length,
          );
          const first = visible[0],
            last = visible.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-sidebar-border px-3">
          <Link
            to="/"
            aria-label="HQ home"
            onClick={() => setMobileOpen(false)}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-mono text-xs font-semibold text-primary-foreground">
              hq
            </span>
            <span className={labelClass}>
              <span className="block text-sm font-semibold">HQ</span>
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Close sidebar"
            onClick={() => setMobileOpen(false)}
          >
            <PanelLeftClose />
          </Button>
        </div>
        <nav
          id="sidebar-navigation"
          aria-label="Main navigation"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 py-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMobileOpen(false);
          }}
        >
          {[
            { to: "/" as const, title: "Home", icon: House },
            { to: "/deen" as const, title: "Nasr", icon: BookOpen },
            { to: "/content" as const, title: "Content", icon: NotebookPen },
            { to: "/github" as const, title: "GitHub", icon: FolderGit2 },
          ].map(({ to, title, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              search={
                to === "/github"
                  ? defaultFilters()
                  : to === "/content"
                    ? {}
                    : undefined
              }
              title={title}
              aria-label={title}
              aria-current={
                (
                  to === "/"
                    ? pathname === "/"
                    : pathname === to || pathname.startsWith(`${to}/`)
                )
                  ? "page"
                  : undefined
              }
              className={navClass}
              onClick={() => setMobileOpen(false)}
            >
              <Icon className="size-4 shrink-0" />
              <span className={labelClass}>{title}</span>
            </Link>
          ))}
        </nav>
        {/* Appearance lives at the foot of the rail, next to the things it
            changes, rather than behind an overflow menu in the top bar. */}
        <div className="shrink-0 border-t border-sidebar-border p-1.5">
          <button
            type="button"
            onClick={ui.toggleTheme}
            title={ui.theme === "dark" ? "Light theme" : "Dark theme"}
            aria-label={
              ui.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
            className={`${navClass} w-full`}
          >
            {/* Both icons and labels render; the stylesheet shows the pair for
                the document's theme, so a stored light preference reads right
                from the server's paint instead of after the store hydrates. */}
            <Sun className="hidden size-4 shrink-0 dark:block" />
            <Moon className="size-4 shrink-0 dark:hidden" />
            <span className={`${labelClass} dark:hidden`}>Dark</span>
            <span className={`${labelClass} hidden dark:inline`}>Light</span>
          </button>
        </div>
      </aside>
      <div
        inert={mobileOpen}
        className={`sidebar-offset min-h-dvh min-w-0 transition-[margin] duration-150 motion-reduce:transition-none ${sidebarOpen ? "md:ml-64" : "md:ml-14"}`}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <header className="flex h-12 items-center gap-3 border-b px-4 md:px-6 lg:px-8">
            <Button
              ref={mobileTrigger}
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="sidebar-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <PanelLeftOpen />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              aria-label={
                sidebarOpen ? "Collapse navigation" : "Expand navigation"
              }
              title={
                sidebarOpen
                  ? "Collapse navigation (Ctrl+B)"
                  : "Expand navigation (Ctrl+B)"
              }
              aria-expanded={sidebarOpen}
              aria-controls="sidebar-navigation"
              onClick={toggleSidebar}
            >
              {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <Breadcrumbs />
            {/* The top bar does one job: a page can be started from anywhere.
                Content registers its own handler so unsaved edits are flushed
                before the new page opens. */}
            <div className="ml-auto flex items-center gap-2">
              <Button
                disabled={creating}
                onClick={() => {
                  setCreating(true);
                  void (ui.pageCreator ?? newPage)().finally(() =>
                    setCreating(false),
                  );
                }}
              >
                <FilePlus2 />
                <span className="hidden sm:inline">New page</span>
                <span className="sr-only sm:hidden">New page</span>
              </Button>
            </div>
          </header>
        </div>
        <main id="main" className="min-w-0 px-4 py-6 md:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
