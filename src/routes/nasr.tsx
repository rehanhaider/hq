import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/nasr")({
  staticData: {
    crumbs: "Nasr",
    views: ({ pathname }) => {
      const path = pathname.replace(/\/$/, "");
      return [
        { label: "Today", to: "/nasr" },
        { label: "Progress", to: "/nasr/history" },
        { label: "Settings", to: "/nasr/settings" },
      ].map((view) => ({ ...view, active: path === view.to }));
    },
  },
  component: () => <Outlet />,
});
