import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { Compass, IsoBlock, IsoChip, IsoGround, IsoScene, ZoomableMap } from "@/components/oee/iso";
import { ComparisonLabel, Delta, Donut, MetricBar, PageHeader, Panel } from "@/components/oee/ui";
import { TIER_HEX, TIER_TEXT, tierOf } from "@/lib/oee/config";
import { PLANTS, type Plant } from "@/lib/oee/data";
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

type PlantHoverData = {
  id: string;
  name: string;
  block: string;
  oee: number;
  runningLines: number;
  downOfflineLines: number;
  downLines: number;
  slowLines: number;
  idleLines: number;
  totalLines: number;
  x: number;
  y: number;
};

function getPlantLineStats(p: Plant) {
  const allLines = p.zones.flatMap((z) => z.lines);
  const running = allLines.filter((l) => l.status === "running").length;
  const down = allLines.filter((l) => l.status === "down").length;
  const slow = allLines.filter((l) => l.status === "slow").length;
  const idle = allLines.filter((l) => l.status === "idle").length;
  return {
    total: allLines.length,
    running,
    downOffline: down + slow + idle,
    down,
    slow,
    idle,
  };
}

function PlantDetailCard({ data }: { data: PlantHoverData | null }) {
  if (!data) return null;
  const tier = tierOf(data.oee);

  return (
    <div
      className="pointer-events-none absolute z-50 flex w-52 flex-col gap-2 rounded-md border border-border bg-background/95 p-4 shadow-xl backdrop-blur select-none transition-all duration-75 text-sm"
      style={{ left: `${data.x}px`, top: `${data.y}px` }}
    >
      {/* Plant Name & Badge */}
      <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <h4 className="truncate font-semibold text-foreground tracking-tight text-sm">
            {data.name}
          </h4>
          <p className="text-[11px] font-mono text-muted-foreground">
            {data.id} · {data.block}
          </p>
        </div>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
            tier === "good"
              ? "bg-tier-good/15 text-tier-good"
              : tier === "warn"
                ? "bg-tier-warn/15 text-tier-warn"
                : "bg-tier-bad/15 text-tier-bad",
          )}
        >
          {tier.toUpperCase()}
        </span>
      </div>

      {/* Current Plant OEE */}
      <div className="flex items-baseline justify-between py-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">Current OEE</span>
        <span className={cn("font-mono font-bold text-base", TIER_TEXT[tier])}>
          {data.oee.toFixed(1)}%
        </span>
      </div>

      {/* Line Aggregates */}
      <div className="flex flex-col gap-1.5 rounded bg-surface/80 p-2 text-xs border border-border/60">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className="size-2 rounded-full bg-status-running ring-1 ring-status-running/30 shrink-0" />
            Total Running Lines
          </span>
          <span className="font-mono font-semibold text-status-running">
            {data.runningLines}{" "}
            <span className="text-[10px] font-normal text-muted-foreground">
              / {data.totalLines}
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className="size-2 rounded-full bg-status-down ring-1 ring-status-down/30 shrink-0" />
            Total Down / Offline
          </span>
          <span className="font-mono font-semibold text-status-down">
            {data.downOfflineLines}{" "}
            <span className="text-[10px] font-normal text-muted-foreground">lines</span>
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-border/50 pt-1 text-[10px] text-muted-foreground">
          <span>{data.downLines} down</span>
          <span>·</span>
          <span>{data.slowLines} slow</span>
          <span>·</span>
          <span>{data.idleLines} idle</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-0.5 text-[10px] font-medium text-primary">
        <span>Click to view plant details</span>
        <span>→</span>
      </div>
    </div>
  );
}

function MultiPlantView() {
  const [period, setPeriod] = useState<PeriodId>("live");
  const [hoveredPlantId, setHoveredPlantId] = useState<string | null>(null);
  const [plantTooltip, setPlantTooltip] = useState<PlantHoverData | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const liveState = useLiveGroupState(period);

  const plantStats = useMemo(() => {
    const map: Record<string, ReturnType<typeof getPlantLineStats>> = {};
    for (const p of PLANTS) {
      map[p.id] = getPlantLineStats(p);
    }
    return map;
  }, []);

  const handlePlantHover = (plant: Plant, e: React.MouseEvent) => {
    setHoveredPlantId(plant.id);
    const rect = mapContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const cardWidth = 208; // w-52
    const cardHeight = 220;

    let targetX = mouseX + 16;
    let targetY = mouseY - 16;

    if (targetX + cardWidth > rect.width - 12) {
      targetX = mouseX - cardWidth - 16;
    }
    targetX = Math.max(12, Math.min(targetX, rect.width - cardWidth - 12));

    if (targetY + cardHeight > rect.height - 12) {
      targetY = mouseY - cardHeight - 8;
    }
    targetY = Math.max(12, Math.min(targetY, rect.height - cardHeight - 12));

    const stats = plantStats[plant.id] ?? getPlantLineStats(plant);
    const livePlant = liveState.plants[plant.id] ?? plant;

    setPlantTooltip({
      id: plant.id,
      name: plant.name,
      block: plant.block,
      oee: livePlant.oee,
      runningLines: stats.running,
      downOfflineLines: stats.downOffline,
      downLines: stats.down,
      slowLines: stats.slow,
      idleLines: stats.idle,
      totalLines: stats.total,
      x: targetX,
      y: targetY,
    });
  };

  const handlePlantLeave = () => {
    setHoveredPlantId(null);
    setPlantTooltip(null);
  };

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
              const isHovered = hoveredPlantId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate({ to: "/live/$plantId", params: { plantId: p.id } })}
                  onMouseEnter={() => setHoveredPlantId(p.id)}
                  onMouseLeave={() => setHoveredPlantId(null)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-all hover:border-primary cursor-pointer",
                    isHovered && "border-primary ring-1 ring-primary/40 bg-surface/90 shadow-sm",
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
                        hovered={hoveredPlantId === p.id}
                        onClick={() =>
                          navigate({ to: "/live/$plantId", params: { plantId: p.id } })
                        }
                        onMouseEnter={(e) => handlePlantHover(p, e)}
                        onMouseMove={(e) => handlePlantHover(p, e)}
                        onMouseLeave={handlePlantLeave}
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

            {/* Floating Plant Detail Card on Hover */}
            <PlantDetailCard data={plantTooltip} />
          </div>
        </Panel>
      </main>
    </div>
  );
}
