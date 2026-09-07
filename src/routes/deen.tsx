import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";

export const Route = createFileRoute("/deen")({ component: DeenLayout });

function DeenLayout() {
  const path = useLocation().pathname.replace(/\/$/, "");
  return (
    <div className="space-y-6">
      <nav aria-label="Nasr pages" className="section-tabs">
        {[
          { to: "/deen" as const, label: "Today" },
          { to: "/deen/history" as const, label: "Progress" },
          { to: "/deen/settings" as const, label: "Settings" },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            aria-current={path === to ? "page" : undefined}
            className="section-tab"
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
