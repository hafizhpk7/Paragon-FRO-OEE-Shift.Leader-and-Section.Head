import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import {
  Compass,
  IsoBlock,
  IsoChip,
  IsoGround,
  IsoScene,
  ZoomableMap,
  MapHoverTooltip,
  type MapTooltipInfo,
} from "@/components/oee/iso";
import { ComparisonLabel, Delta, Donut, MetricBar, PageHeader, Panel } from "@/components/oee/ui";
import { TIER_HEX, tierOf } from "@/lib/oee/config";
import { PLANTS } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
import { useLiveGroupState } from "@/lib/oee/live-display";
import { cn } from "@/lib/utils";

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
  const [tooltip, setTooltip] = useState<MapTooltipInfo | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const liveState = useLiveGroupState(period);

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
        <div
          className={cn(
            "flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4 transition-colors",
            liveState.isUpdating && "border-primary/50 shadow-[0_0_12px_rgba(59,130,246,0.15)]",
          )}
        >
          <div className="flex items-center gap-4 pr-4">
            <div className="flex flex-col items-center">
              <Donut value={liveState.group.oee} size={92} label="Group OEE" />
              <div className="mt-1 flex flex-col items-center text-center">
                <Delta value={liveState.groupDeltas.oee} />
                <ComparisonLabel period={period} />
              </div>
            </div>
            <div className="grid w-44 gap-1.5">
              <MetricBar label="Availability" value={liveState.group.availability} />
              <MetricBar label="Performance" value={liveState.group.performance} />
              <MetricBar label="Quality" value={liveState.group.quality} />
            </div>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            {PLANTS.map((p) => {
              const livePlant = liveState.plants[p.id] ?? p;
              const deltaVal = liveState.plantDeltas[p.id] ?? 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate({ to: "/live/$plantId", params: { plantId: p.id } })}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary cursor-pointer",
                    liveState.isUpdating && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex flex-col items-center">
                    <Donut value={livePlant.oee} size={58} label={p.id} />
                    <div className="mt-1 flex flex-col items-center text-center">
                      <Delta value={deltaVal} />
                      <ComparisonLabel period={period} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-xs font-semibold">{p.name}</p>
                    <MetricBar label="A" value={livePlant.availability} />
                    <MetricBar label="P" value={livePlant.performance} />
                    <MetricBar label="Q" value={livePlant.quality} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Panel
          className="flex-1"
          title="Group site map"
          subtitle="Click a plant building to drill into Plant View"
          bodyClassName="relative p-0"
        >
          <div ref={mapContainerRef} className="relative h-full w-full flex-1">
            <Compass />
            <ZoomableMap className="min-h-[420px] flex-1">
              <IsoScene viewBox="-205 -115 400 340">
                <IsoGround cols={7} rows={7} s={34} />
                {PLANTS.map((p, i) => {
                  const livePlant = liveState.plants[p.id] ?? p;
                  const tier = tierOf(livePlant.oee);
                  const x = 0.6 + (i % 2) * 3.2;
                  const y = 0.6 + i * 1.9;
                  const h = 26 + livePlant.oee * 0.7;
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
                        onClick={() =>
                          navigate({ to: "/live/$plantId", params: { plantId: p.id } })
                        }
                        onMouseEnter={(e) => {
                          const rect = mapContainerRef.current?.getBoundingClientRect();
                          if (rect) {
                            setTooltip({
                              title: p.name,
                              subtitle: `Plant ${p.id} · Block ${p.block}`,
                              status:
                                tier === "good" ? "running" : tier === "warn" ? "slow" : "down",
                              statusLabel:
                                tier === "good"
                                  ? "Optimal"
                                  : tier === "warn"
                                    ? "Warning"
                                    : "Attention",
                              oee: livePlant.oee,
                              x: e.clientX - rect.left,
                              y: e.clientY - rect.top,
                            });
                          }
                        }}
                        onMouseMove={(e) => {
                          const rect = mapContainerRef.current?.getBoundingClientRect();
                          if (rect) {
                            setTooltip((curr) =>
                              curr
                                ? { ...curr, x: e.clientX - rect.left, y: e.clientY - rect.top }
                                : {
                                    title: p.name,
                                    subtitle: `Plant ${p.id} · Block ${p.block}`,
                                    status:
                                      tier === "good"
                                        ? "running"
                                        : tier === "warn"
                                          ? "slow"
                                          : "down",
                                    statusLabel:
                                      tier === "good"
                                        ? "Optimal"
                                        : tier === "warn"
                                          ? "Warning"
                                          : "Attention",
                                    oee: livePlant.oee,
                                    x: e.clientX - rect.left,
                                    y: e.clientY - rect.top,
                                  },
                            );
                          }
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      />
                      <IsoChip
                        x={x + 1.2}
                        y={y + 0.85}
                        s={34}
                        h={h}
                        label={p.id}
                        value={`${livePlant.oee.toFixed(0)}%`}
                        color={TIER_HEX[tier]}
                      />
                    </g>
                  );
                })}
              </IsoScene>
            </ZoomableMap>

            <MapHoverTooltip info={tooltip} />
          </div>
        </Panel>
      </main>
    </div>
  );
}
