import { Navigate, createFileRoute } from "@tanstack/react-router";

import { useApp } from "@/lib/oee/app-context";
import { DEFAULT_PLANT_ID, DEFAULT_ZONE_ID } from "@/lib/oee/data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OEE FRO Dashboard — Live Monitor" },
      {
        name: "description",
        content:
          "OEE FRO dashboard prototype entry point: redirects to the Live Monitor dashboard for Shift Leader and Section Head.",
      },
      { property: "og:title", content: "OEE FRO Dashboard — Live Monitor" },
      {
        property: "og:description",
        content:
          "Live monitor drill-down and OEE analytics prototype for Shift Leader and Section Head.",
      },
    ],
  }),
  component: HomeRedirect,
});

// Root URL always lands on the Live Monitor dashboard.
// Shift Leader → their zone view; Section Head → multi plant view.
function HomeRedirect() {
  const { role } = useApp();

  if (role === "section-head") {
    return <Navigate to="/live" replace />;
  }
  return (
    <Navigate
      to="/live/$plantId/$zoneId"
      params={{ plantId: DEFAULT_PLANT_ID, zoneId: DEFAULT_ZONE_ID }}
      replace
    />
  );
}
