import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Compass, IsoBlock, IsoChip, IsoGround, IsoScene, ZoomableMap } from "@/components/oee/iso";
import { Donut, MetricBar, PageHeader, Panel } from "@/components/oee/ui";
import { TIER_HEX, tierOf } from "@/lib/oee/config";
import { GROUP, PLANTS } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";

export const Route = createFileRoute("/live/")({
  head: () => ({
    meta: [
      { title: "Multi Plant View — Live Monitor" },
      {
        name: "description",
        content:
          "Group level live monitor: OEE per plant on an isometric site map, drill into any plant.",
      },
      { property: "og:title", content: "Multi Plant View — Live Monitor" },
      { property: "og:description", content: "Group level live monitor with OEE per plant." },
    ],
  }),
  component: MultiPlantView,
});

function MultiPlantView() {
  const [period, setPeriod] = useState<PeriodId>("live");
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title="Multi Plant View"
        crumbs={[{ label: "Kemas", to: "/" }, { label: "Multi Plant" }]}
        period={period}
        onPeriod={setPeriod}
        meta="Week 32 · 05-Aug 14:22"
      />
      <main className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-4 pr-4">
            <Donut value={GROUP.oee} size={92} label="Group OEE" />
            <div className="grid w-44 gap-1.5">
              <MetricBar label="Availability" value={GROUP.availability} />
              <MetricBar label="Performance" value={GROUP.performance} />
              <MetricBar label="Quality" value={GROUP.quality} />
            </div>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            {PLANTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate({ to: "/live/$plantId", params: { plantId: p.id } })}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary"
              >
                <Donut value={p.oee} size={58} label={p.id} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-xs font-semibold">{p.name}</p>
                  <MetricBar label="A" value={p.availability} />
                  <MetricBar label="P" value={p.performance} />
                  <MetricBar label="Q" value={p.quality} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <Panel
          className="flex-1"
          title="Group site map"
          subtitle="Click a plant building to drill into Plant View"
          bodyClassName="relative p-0"
        >
          <Compass />
          <ZoomableMap className="min-h-[420px] flex-1">
            <IsoScene viewBox="-205 -115 400 340">
              <IsoGround cols={7} rows={7} s={34} />
              {PLANTS.map((p, i) => {
                const tier = tierOf(p.oee);
                const x = 0.6 + (i % 2) * 3.2;
                const y = 0.6 + i * 1.9;
                const h = 26 + p.oee * 0.7;
                return (
                  <g key={p.id}>
                    <IsoBlock
                      x={x}
                      y={y}
                      w={2.4}
                      d={1.7}
                      h={h}
                      s={34}
                      color={TIER_HEX[tier]}
                      onClick={() => navigate({ to: "/live/$plantId", params: { plantId: p.id } })}
                    />
                    <IsoChip
                      x={x + 1.2}
                      y={y + 0.85}
                      s={34}
                      h={h}
                      label={p.id}
                      value={`${p.oee.toFixed(0)}%`}
                      color={TIER_HEX[tier]}
                    />
                  </g>
                );
              })}
            </IsoScene>
          </ZoomableMap>
        </Panel>
      </main>
    </div>
  );
}
