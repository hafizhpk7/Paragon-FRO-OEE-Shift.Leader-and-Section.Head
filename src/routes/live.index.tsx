import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  Compass as CompassIcon,
  Eye,
  Layers,
  MapPin,
  Maximize2,
  Navigation,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import satelliteMapImg from "@/assets/images/jatake_satellite_map.jpg";
import { ComparisonLabel, Delta, Donut, MetricBar, PageHeader, Panel } from "@/components/oee/ui";
import { TIER_BG, TIER_BORDER, TIER_HEX, TIER_TEXT, tierOf } from "@/lib/oee/config";
import { PLANTS, type Plant } from "@/lib/oee/data";
import { usePeriod } from "@/lib/oee/period";
import { getMetrics, useLiveTick } from "@/lib/oee/metrics-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/")({
  head: () => ({
    meta: [
      { title: "Multi Plant View — Live Monitor" },
      {
        name: "description",
        content:
          "Group level live monitor: 3D satellite view of Paragon manufacturing facilities with real-time OEE telemetry.",
      },
      { property: "og:title", content: "Multi Plant View — Live Monitor" },
      {
        property: "og:description",
        content: "Group level live monitor with OEE per plant on 3D satellite view.",
      },
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
  downMachines: number;
  totalMachines: number;
  x: number;
  y: number;
};

// Precise geospatial positioning and details for Paragon Jatake estate plants
// Directly aligned to satellite placemarks:
// a. Paragon Jatake 1: top: 35%; left: 51%;
// b. Paragon Jatake 2: top: 13%; left: 74%;
// c. Paragon Jatake 4: top: 86%; left: 15%;
const SATELLITE_PLANT_CONFIG: Record<
  string,
  {
    displayName: string;
    subLabel: string;
    top: string;
    left: string;
    footprint: {
      width: string;
      height: string;
      rotate: string;
    };
  }
> = {
  J1: {
    displayName: "Paragon Jatake 1",
    subLabel: "Blok 3 · Filling & Packaging",
    top: "35%",
    left: "51%",
    footprint: {
      width: "135px",
      height: "90px",
      rotate: "-6deg",
    },
  },
  J2: {
    displayName: "Paragon Jatake 2",
    subLabel: "Blok 7 · Main Production Complex",
    top: "13%",
    left: "74%",
    footprint: {
      width: "150px",
      height: "100px",
      rotate: "12deg",
    },
  },
  J4: {
    displayName: "Paragon Jatake 4",
    subLabel: "Blok 12 · Advanced Processing",
    top: "86%",
    left: "15%",
    footprint: {
      width: "140px",
      height: "90px",
      rotate: "-3deg",
    },
  },
};

function getPlantLineStats(p: Plant) {
  const allLines = p.zones.flatMap((z) => z.lines);
  const allMachines = allLines.flatMap((l) => l.machines);
  const running = allLines.filter((l) => l.status === "running").length;
  const down = allLines.filter((l) => l.status === "down").length;
  const slow = allLines.filter((l) => l.status === "slow").length;
  const idle = allLines.filter((l) => l.status === "idle").length;
  const downMachines = allMachines.filter((m) => m.status === "down").length;
  return {
    total: allLines.length,
    running,
    downOffline: down + slow + idle,
    down,
    slow,
    idle,
    totalMachines: allMachines.length,
    downMachines,
  };
}

function PlantDetailCard({ data }: { data: PlantHoverData | null }) {
  if (!data) return null;
  const tier = tierOf(data.oee);

  return (
    <div
      className="pointer-events-none absolute z-50 flex w-60 flex-col gap-2 rounded-lg border border-border/80 bg-background/95 p-3.5 shadow-2xl backdrop-blur-md select-none transition-all duration-75 text-sm ring-1 ring-border"
      style={{ left: `${data.x}px`, top: `${data.y}px` }}
    >
      {/* Plant Name & Badge */}
      <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-primary shrink-0" />
            <h4 className="truncate font-semibold text-foreground tracking-tight text-sm">
              {data.name}
            </h4>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground pl-5">
            {data.id} · {data.block}
          </p>
        </div>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase shrink-0",
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
        <span className="text-[11px] font-medium text-muted-foreground">Current Plant OEE</span>
        <span className={cn("font-mono font-bold text-base", TIER_TEXT[tier])}>
          {data.oee.toFixed(1)}%
        </span>
      </div>

      {/* Line Aggregates & Down Machines */}
      <div className="flex flex-col gap-1.5 rounded bg-surface/80 p-2.5 text-xs border border-border/60">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className="size-2 rounded-full bg-status-running ring-1 ring-status-running/30 shrink-0" />
            Running Lines
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
            Down Machines
          </span>
          <span className="font-mono font-semibold text-status-down">
            {data.downMachines}{" "}
            <span className="text-[10px] font-normal text-muted-foreground">
              / {data.totalMachines} units
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-border/50 pt-1 text-[10px] text-muted-foreground">
          <span>{data.downLines} down lines</span>
          <span>·</span>
          <span>{data.slowLines} slow</span>
          <span>·</span>
          <span>{data.idleLines} idle</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-0.5 text-[10px] font-medium text-primary">
        <span>Click to view live lines & machines</span>
        <span>→</span>
      </div>
    </div>
  );
}

export function MultiPlantView() {
  const { resolved } = usePeriod();
  const tick = useLiveTick();
  const [hoveredPlantId, setHoveredPlantId] = useState<string | null>(null);
  const [plantTooltip, setPlantTooltip] = useState<PlantHoverData | null>(null);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("2d");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Metrics from central metrics engine
  const groupMetrics = useMemo(() => {
    void tick;
    return getMetrics("all", "group", "group", resolved);
  }, [resolved, tick]);

  const plantMetrics = useMemo(() => {
    void tick;
    const map: Record<string, ReturnType<typeof getMetrics>> = {};
    for (const p of PLANTS) {
      map[p.id] = getMetrics(p.id, "plant", p.id, resolved);
    }
    return map;
  }, [resolved, tick]);

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

    const cardWidth = 240;
    const cardHeight = 230;

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
    const livePlant = plantMetrics[plant.id] ?? plant;
    const config = SATELLITE_PLANT_CONFIG[plant.id];

    setPlantTooltip({
      id: plant.id,
      name: config?.displayName ?? plant.name,
      block: plant.block,
      oee: livePlant.oee,
      runningLines: stats.running,
      downOfflineLines: stats.downOffline,
      downLines: stats.down,
      slowLines: stats.slow,
      idleLines: stats.idle,
      totalLines: stats.total,
      downMachines: stats.downMachines,
      totalMachines: stats.totalMachines,
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
        crumbs={[{ label: "Kemas", to: "/live" }, { label: "Multi Plant" }]}
      />
      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden">
        {/* Top Summary & Plant Cards */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 rounded-lg border border-border bg-surface p-3 sm:p-4 transition-colors">
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-start gap-4 pb-3 lg:pb-0 lg:pr-4 border-b lg:border-b-0 lg:border-r border-border/60">
            <div className="flex flex-col items-center shrink-0">
              <Donut value={groupMetrics.oee} size={92} label="Group OEE" />
              <div className="mt-1 flex flex-col items-center text-center">
                <Delta value={groupMetrics.deltaOee} label={resolved.compareLabel} />
              </div>
            </div>
            <div className="grid w-full sm:w-44 gap-1.5 min-w-36">
              <MetricBar label="Availability" value={groupMetrics.availability} />
              <MetricBar label="Performance" value={groupMetrics.performance} />
              <MetricBar label="Quality" value={groupMetrics.quality} />
            </div>
          </div>
          <div className="grid w-full flex-1 gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {PLANTS.map((p) => {
              const livePlant = plantMetrics[p.id] ?? p;
              const deltaVal = livePlant.deltaOee;
              const isHovered = hoveredPlantId === p.id;
              const config = SATELLITE_PLANT_CONFIG[p.id];
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
                  )}
                >
                  <div className="flex flex-col items-center">
                    <Donut value={livePlant.oee} size={58} label={p.id} />
                    <div className="mt-1 flex flex-col items-center text-center">
                      <Delta value={deltaVal} label={resolved.compareLabel} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-xs font-semibold">
                        {config?.displayName ?? p.name}
                      </p>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {p.block}
                      </span>
                    </div>
                    <MetricBar label="A" value={livePlant.availability} />
                    <MetricBar label="P" value={livePlant.performance} />
                    <MetricBar label="Q" value={livePlant.quality} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3D Satellite Map Panel */}
        <Panel
          className="flex-1 w-full min-w-0"
          title="Group site map"
          subtitle={
            viewMode === "3d"
              ? "3D satellite perspective of Paragon industrial manufacturing facilities · Click a marker to drill in"
              : "Top-down satellite overview of Paragon industrial manufacturing facilities · Click a marker to drill in"
          }
          bodyClassName="relative p-0 overflow-hidden"
        >
          <div
            ref={mapContainerRef}
            className="relative h-[440px] sm:h-[560px] lg:h-[640px] min-h-[400px] w-full overflow-hidden rounded-b-lg bg-slate-950 flex items-center justify-center select-none"
          >
            {/* 3D Perspective Stage */}
            <div
              className="relative h-full w-full overflow-hidden flex items-center justify-center"
              style={{ perspective: "1200px", transformStyle: "preserve-3d" }}
            >
              {/* Tilted Satellite Surface Plane */}
              <div
                className="relative transition-transform duration-700 ease-out flex items-center justify-center"
                style={{
                  transform:
                    viewMode === "3d"
                      ? "rotateX(46deg) rotateZ(-16deg) scale(0.88)"
                      : "rotateX(0deg) rotateZ(0deg) scale(0.92)",
                  transformStyle: "preserve-3d",
                }}
              >
                {/* Exact aspect ratio container matching jatake_satellite_map.jpg (1600x2017) */}
                <div
                  className="relative aspect-[1600/2017] h-[600px] sm:h-[680px] max-w-none shadow-2xl rounded-xl ring-1 ring-white/15"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  {/* Base Satellite Imagery */}
                  <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                    <img
                      src={satelliteMapImg}
                      alt="Paragon Tangerang Industrial Site Satellite View"
                      className="h-full w-full object-cover filter brightness-[0.96] contrast-[1.06] select-none pointer-events-none"
                    />

                    {/* Satellite HUD Grid & Scanlines Overlay */}
                    <div
                      className="pointer-events-none absolute inset-0 bg-radial from-transparent via-black/10 to-black/35"
                      style={{
                        backgroundImage: `
                          linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                          linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
                        `,
                        backgroundSize: "64px 64px",
                      }}
                    />
                  </div>

                  {/* 3D Interactive Markers (Overlaying seamlessly on the blue placemarks) */}
                  {PLANTS.map((plant) => {
                    const config = SATELLITE_PLANT_CONFIG[plant.id];
                    if (!config) return null;
                    const livePlant = plantMetrics[plant.id] ?? plant;
                    const tier = tierOf(livePlant.oee);
                    const isHovered = hoveredPlantId === plant.id;
                    const stats = plantStats[plant.id] ?? getPlantLineStats(plant);

                    return (
                      <div
                        key={`pin-${plant.id}`}
                        className="absolute"
                        style={{
                          top: config.top,
                          left: config.left,
                          transform: "translate(-50%, -100%)",
                          transformStyle: "preserve-3d",
                        }}
                      >
                        {/* Ground Anchor: Pulsing radar rings centered directly on top of the blue placemark */}
                        <div
                          className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
                          style={{ transformStyle: "preserve-3d" }}
                        >
                          <span
                            className={cn(
                              "absolute size-8 rounded-full animate-ping opacity-45",
                              tier === "good"
                                ? "bg-tier-good"
                                : tier === "warn"
                                  ? "bg-tier-warn"
                                  : "bg-tier-bad",
                            )}
                          />
                          <span
                            className={cn(
                              "size-3 rounded-full border-2 border-white shadow-[0_0_12px_rgba(59,130,246,0.9)] transition-transform duration-200",
                              tier === "good"
                                ? "bg-blue-500"
                                : tier === "warn"
                                  ? "bg-amber-500"
                                  : "bg-rose-500",
                              isHovered && "scale-150 ring-4 ring-primary/50",
                            )}
                          />
                        </div>

                        {/* Floating Billboard Pin & Label: Counteracts parent 3D rotation so badge is upright & crisp */}
                        <div
                          onClick={() =>
                            navigate({ to: "/live/$plantId", params: { plantId: plant.id } })
                          }
                          onMouseEnter={(e) => handlePlantHover(plant, e)}
                          onMouseMove={(e) => handlePlantHover(plant, e)}
                          onMouseLeave={handlePlantLeave}
                          className={cn(
                            "group relative flex flex-col items-center cursor-pointer select-none pb-1",
                            isHovered ? "z-40 scale-110" : "z-20 hover:scale-105",
                          )}
                          style={{
                            transformOrigin: "50% 100%",
                            transform:
                              viewMode === "3d"
                                ? "rotateZ(16deg) rotateX(-46deg) translateZ(16px)"
                                : "rotateZ(0deg) rotateX(0deg) translateZ(0px)",
                            transformStyle: "preserve-3d",
                            backfaceVisibility: "visible",
                            WebkitBackfaceVisibility: "visible",
                            transition:
                              "transform 700ms cubic-bezier(0.16, 1, 0.3, 1), scale 200ms ease",
                          }}
                        >
                          {/* Modern Interactive Marker Badge */}
                          <div
                            className={cn(
                              "flex flex-col gap-1 rounded-lg border p-2 shadow-2xl backdrop-blur-md transition-all duration-200 min-w-[165px] text-left",
                              isHovered
                                ? "border-primary bg-slate-900/95 ring-2 ring-primary/60 shadow-[0_0_24px_rgba(59,130,246,0.5)]"
                                : "border-slate-700/80 bg-slate-900/90 hover:border-slate-500 hover:bg-slate-900/95",
                            )}
                          >
                            {/* Header: MapPin icon + Plant Name + OEE pill */}
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={cn(
                                    "flex size-5 shrink-0 items-center justify-center rounded-full text-white shadow-sm",
                                    tier === "good"
                                      ? "bg-blue-600"
                                      : tier === "warn"
                                        ? "bg-amber-600"
                                        : "bg-rose-600",
                                  )}
                                >
                                  <MapPin className="size-3 fill-white" />
                                </span>
                                <span className="truncate font-semibold text-xs tracking-tight text-white">
                                  {config.displayName}
                                </span>
                              </div>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold shrink-0",
                                  tier === "good"
                                    ? "bg-tier-good/20 text-tier-good"
                                    : tier === "warn"
                                      ? "bg-tier-warn/20 text-tier-warn"
                                      : "bg-tier-bad/20 text-tier-bad",
                                )}
                              >
                                {livePlant.oee.toFixed(1)}%
                              </span>
                            </div>

                            {/* Subtitle: Block + Active Lines + Down Machines */}
                            <div className="flex items-center justify-between text-[10px] text-slate-300 font-medium pt-1 border-t border-slate-800">
                              <span className="text-slate-400 font-mono">{plant.block}</span>
                              <span className="flex items-center gap-1 text-slate-200">
                                <span className="size-1.5 rounded-full bg-status-running shrink-0" />
                                {stats.running}/{stats.total} Lines
                              </span>
                              {stats.downMachines > 0 ? (
                                <span className="text-red-400 font-mono font-semibold">
                                  {stats.downMachines} Down
                                </span>
                              ) : (
                                <span className="text-emerald-400 font-mono">0 Down</span>
                              )}
                            </div>
                          </div>

                          {/* Pointer tip pointing directly downward onto the blue placemark */}
                          <div
                            className={cn(
                              "w-0 h-0 border-x-[6px] border-x-transparent border-t-[8px] transition-colors -mt-[1px]",
                              isHovered ? "border-t-primary" : "border-t-slate-700/90",
                            )}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Flat HUD Overlays (2D Layer, Screen-Relative) */}
            {/* Top-Left: Estate & Telemetry Header */}
            <div className="pointer-events-none absolute top-3.5 left-3.5 z-20 flex flex-col gap-1">
              <div className="flex items-center gap-2 rounded-md border border-slate-700/70 bg-slate-900/85 px-2.5 py-1 text-xs text-white shadow-lg backdrop-blur">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span className="font-semibold tracking-wide text-[11px] uppercase">
                  {viewMode === "3d" ? "3D Satellite View" : "Top-Down Satellite"}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-[11px] text-slate-300 font-mono">
                  Jatake Industrial Estate
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 pl-1">
                <span>LAT -6.1925° S</span>
                <span>·</span>
                <span>LON 106.5741° E</span>
                <span>·</span>
                <span>Tangerang, Banten</span>
              </div>
            </div>

            {/* Top-Right: Perspective Controls */}
            <div className="pointer-events-auto absolute top-3.5 right-3.5 z-20 flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-slate-900/85 p-1 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => setViewMode("3d")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  viewMode === "3d"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-800",
                )}
                title="Tilted 3D Google Earth Perspective"
              >
                <Layers className="size-3.5" />
                3D Perspective
              </button>
              <button
                type="button"
                onClick={() => setViewMode("2d")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  viewMode === "2d"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-800",
                )}
                title="Top-Down Overhead 2D View"
              >
                <Eye className="size-3.5" />
                Top-Down
              </button>
            </div>

            {/* Bottom-Left: Map Scale Indicator */}
            <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-20 flex items-center gap-2 text-[10px] font-mono text-slate-400 bg-slate-900/75 border border-slate-800 px-2 py-0.5 rounded backdrop-blur">
              <span className="h-1.5 w-8 border-b border-l border-r border-slate-400 inline-block" />
              <span>100m · High-Res Orthophoto</span>
            </div>

            {/* Bottom-Right: Compass Azimuth Dial */}
            <div className="pointer-events-none absolute bottom-3.5 right-3.5 z-20 flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-slate-900/80 px-2 py-1 text-xs text-white shadow-lg backdrop-blur">
              <div
                className="transition-transform duration-700 ease-out"
                style={{ transform: viewMode === "3d" ? "rotate(-16deg)" : "rotate(0deg)" }}
              >
                <Navigation className="size-4 text-rose-500 fill-rose-500" />
              </div>
              <span className="font-mono text-[10px] font-bold text-slate-300">
                {viewMode === "3d" ? "N -16°" : "N 0°"}
              </span>
            </div>

            {/* Floating Plant Detail Card on Hover */}
            <PlantDetailCard data={plantTooltip} />
          </div>
        </Panel>
      </main>
    </div>
  );
}
