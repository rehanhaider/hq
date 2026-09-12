import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/deen")({
  staticData: {
    crumbs: "Nasr",
    views: ({ pathname }) => {
      const path = pathname.replace(/\/$/, "");
      return [
        { label: "Today", to: "/deen" },
        { label: "Progress", to: "/deen/history" },
        { label: "Settings", to: "/deen/settings" },
      ].map((view) => ({ ...view, active: path === view.to }));
    },
  },
  component: () => <Outlet />,
});
