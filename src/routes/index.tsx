import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paragon OEE FRO Dashboard — Live Monitor" },
      {
        name: "description",
        content:
          "Paragon OEE FRO dashboard prototype entry point: redirects to the Live Monitor dashboard.",
      },
      { property: "og:title", content: "Paragon OEE FRO Dashboard — Live Monitor" },
      {
        property: "og:description",
        content: "Live monitor drill-down and OEE analytics prototype for Paragon Manufacturing.",
      },
    ],
  }),
  component: HomeRedirect,
});

function HomeRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/live", replace: true });
  }, [navigate]);

  return null;
}
