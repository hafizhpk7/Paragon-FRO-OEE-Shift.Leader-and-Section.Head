import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { LossTree, MeasureToggle, Waterfall, type Measure } from "@/components/oee/charts";
import { FilterBar } from "@/components/oee/filter-bar";
import { NoDataForFilters, PageHeader, Panel } from "@/components/oee/ui";
import { useApp } from "@/lib/oee/app-context";
import { lossTree, waterfall } from "@/lib/oee/data";
import { useScope } from "@/lib/oee/scope";

export const Route = createFileRoute("/analytics/loss-tree")({
  head: () => ({
    meta: [
      { title: "Loss Tree & OEE Waterfall — Loss Anatomy" },
      {
        name: "description",
        content:
          "OEE waterfall from calendar time to effective time next to a multi-level loss tree, switchable by minutes or occurrences.",
      },
      { property: "og:title", content: "Loss Tree & OEE Waterfall" },
      {
        property: "og:description",
        content: "Waterfall plus multi-level loss tree, by minutes or by occurrences.",
      },
    ],
  }),
  component: LossTreePage,
});

function LossTreePage() {
  const { role } = useApp();
  const scope = useScope();
  const navigate = useNavigate();
  const [measure, setMeasure] = useState<Measure>("minutes");

  const dashboard = role === "section-head" ? "Section Head Dashboard" : "Shift Leader Dashboard";
  const wf = useMemo(() => waterfall(scope.seed), [scope.seed]);
  const tree = useMemo(() => lossTree(scope.seed), [scope.seed]);

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title="Loss Anatomy"
        crumbs={[{ label: dashboard, to: "/analytics" }, { label: "Loss Tree" }]}
        back={{ label: dashboard, to: "/analytics" }}
        meta={`Week 32 · ${scope.spanLabel}`}
      />
      <FilterBar />
      {!scope.hasData ? (
        <main className="flex-1 p-4">
          <NoDataForFilters />
        </main>
      ) : (
        <main className="grid flex-1 w-full gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden grid-cols-1 lg:grid-cols-2">
          <Panel
            title="OEE Waterfall"
            subtitle={scope.scopeLabel}
            className="w-full min-w-0 overflow-hidden"
            bodyClassName="min-h-0 p-0 w-full min-w-0 overflow-x-auto"
          >
            <div className="w-full min-w-[460px] sm:min-w-0">
              <Waterfall milestones={wf.milestones} losses={wf.losses} />
            </div>
          </Panel>

          <Panel
            title="Loss Tree"
            action={<MeasureToggle value={measure} onChange={setMeasure} />}
            className="w-full min-w-0 overflow-hidden"
            bodyClassName="min-h-0 overflow-auto p-3"
          >
            <LossTree
              nodes={tree}
              measure={measure}
              onOpen={(node) =>
                navigate({
                  to: "/analytics/pareto",
                  search: { category: node.label, measure },
                })
              }
            />
          </Panel>
        </main>
      )}
    </div>
  );
}
