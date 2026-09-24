import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";

import { MeasureToggle, ParetoChart, type Measure } from "@/components/oee/charts";
import { FilterBar } from "@/components/oee/filter-bar";
import { EmptyState, NoDataForFilters, PageHeader, Panel } from "@/components/oee/ui";
import { useApp } from "@/lib/oee/app-context";
import { findNode, lossTree, type LossNode } from "@/lib/oee/data";
import { useScope } from "@/lib/oee/scope";

const searchSchema = z.object({
  category: fallback(z.string(), "").default(""),
  measure: fallback(z.string(), "minutes").default("minutes"),
});

export const Route = createFileRoute("/analytics/pareto")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Root Cause Pareto Chart — OEE Analytics" },
      {
        name: "description",
        content:
          "Pareto drill-down across every loss category: parent issues, child issues level 1 and level 2, plus rank by machines.",
      },
      { property: "og:title", content: "Root Cause Pareto Chart" },
      {
        property: "og:description",
        content: "Parent issues → child issues level 1 → level 2 pareto drill-down.",
      },
    ],
  }),
  component: ParetoPage,
});

function ParetoPage() {
  const { role } = useApp();
  const scope = useScope();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [measure, setMeasure] = useState<Measure>(
    search.measure === "occurrences" ? "occurrences" : "minutes",
  );

  const tree = useMemo(() => lossTree(scope.seed), [scope.seed]);
  const initialParent = tree.find((n) => n.label === search.category)?.id ?? "";
  const [parentId, setParentId] = useState<string>(initialParent);
  const [childId, setChildId] = useState<string>("");

  const dashboard = role === "section-head" ? "Section Head Dashboard" : "Shift Leader Dashboard";
  const val = (n: LossNode) => (measure === "minutes" ? n.minutes : n.occurrences);
  const toRow = (n: LossNode) => ({ id: n.id, label: n.label, value: val(n) });

  const parent = parentId ? findNode(tree, parentId) : undefined;
  const child = childId ? findNode(tree, childId) : undefined;
  const rankNode = child ?? parent;

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title="Root Cause Pareto Chart"
        crumbs={[
          { label: dashboard, to: "/analytics" },
          { label: "Loss Tree", to: "/analytics/loss-tree" },
          { label: "Root Cause Pareto Chart" },
        ]}
        back={{ label: "Loss Tree", to: "/analytics/loss-tree" }}
        meta={`Week 32 · ${scope.spanLabel}`}
      />
      <FilterBar />
      {!scope.hasData ? (
        <main className="flex-1 p-4">
          <NoDataForFilters />
        </main>
      ) : (
        <main className="flex flex-1 flex-col gap-3 p-4">
          <Panel
            className="min-h-[340px] flex-1"
            title="Parent Issues"
            subtitle="All loss categories at once · click a bar to drill down"
            action={
              <MeasureToggle
                value={measure}
                onChange={(m) => {
                  setMeasure(m);
                  navigate({ to: "/analytics/pareto", search: { ...search, measure: m } });
                }}
              />
            }
          >
            <ParetoChart
              data={[...tree].sort((a, b) => val(b) - val(a)).map(toRow)}
              selected={parentId}
              onSelect={(id) => {
                setParentId(id);
                setChildId("");
              }}
            />
          </Panel>

          <div className="grid min-h-[340px] flex-1 auto-rows-fr items-stretch gap-3 lg:grid-cols-2">
            <Panel
              title="Child Issues Level 1"
              subtitle={parent ? `Scoped to ${parent.label}` : undefined}
            >
              {parent?.children?.length ? (
                <ParetoChart
                  data={[...parent.children].sort((a, b) => val(b) - val(a)).map(toRow)}
                  selected={childId}
                  onSelect={(id) => setChildId(id)}
                />
              ) : (
                <EmptyState message="Silahkan Pilih Child Issues Level 1" />
              )}
            </Panel>

            <Panel
              title="Child Issues Level 2"
              subtitle={child ? `Scoped to ${child.label}` : undefined}
            >
              {child?.children?.length ? (
                <ParetoChart
                  data={[...child.children].sort((a, b) => val(b) - val(a)).map(toRow)}
                />
              ) : (
                <EmptyState message="Silahkan Pilih Child Issues Level 2" />
              )}
            </Panel>
          </div>

          {/* §7 point 3: "Rank by Machines" is not shown in the After mockup; kept here
              as an extra panel so the information is not lost. */}
          <Panel
            title="Rank by Machines"
            subtitle={
              rankNode
                ? `${rankNode.label} · ${measure === "minutes" ? "minutes" : "occurrences"}`
                : "Select an issue above"
            }
          >
            {rankNode ? (
              <ul className="space-y-1.5">
                {rankNode.machines.map((m) => {
                  const max = Math.max(
                    ...rankNode.machines.map((x) =>
                      measure === "minutes" ? x.minutes : x.occurrences,
                    ),
                    1,
                  );
                  const v = measure === "minutes" ? m.minutes : m.occurrences;
                  return (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 font-mono text-[11px]">{m.id}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded bg-grid/40">
                        <div
                          className="h-full rounded bg-primary"
                          style={{ width: `${(v / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right font-mono text-[11px]">
                        {measure === "minutes" ? `${v} min` : `${v}×`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState message="Silahkan Pilih Parent Issue" />
            )}
          </Panel>
        </main>
      )}
    </div>
  );
}
