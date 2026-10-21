import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import {
  Compass,
  IsoBlock,
  IsoChip,
  IsoGround,
  IsoScene,
  IsoBottleneckMarker,
  ZoomableMap,
  MapHoverTooltip,
  MapStatusLegendOverlay,
  type MapTooltipInfo,
} from "@/components/oee/iso";
import { J2PlantZoneMap } from "@/components/oee/j2-shopfloor-maps";
import {
  ComparisonLabel,
  Delta,
  Donut,
  EmptyState,
  MetricBar,
  PageHeader,
  Panel,
  StatusLegend,
} from "@/components/oee/ui";
import { EntityKpiCard } from "@/components/oee/entity-kpi-card";
import { STATUS_HEX, STATUS_LABEL, TIER_HEX, tierOf } from "@/lib/oee/config";
import { getPlant, plantAlarms, PLANT_PHASE_LABELS } from "@/lib/oee/data";
import { usePeriod } from "@/lib/oee/period";
import {
  getMetrics,
  getBottleneck,
  getActivePO,
  PO_IDLE_PLACEHOLDER,
  useLiveTick,
} from "@/lib/oee/metrics-engine";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/$plantId/")({
  head: () => ({
    meta: [
      { title: "Plant View — Live Monitor" },
      {
        name: "description",
        content:
          "Plant level live monitor: zone OEE cards, alarms this shift, and an isometric zone map.",
      },
      { property: "og:title", content: "Plant View — Live Monitor" },
      {
        property: "og:description",
        content: "Zone OEE, alarms and isometric zone map for one plant.",
      },
    ],
  }),
  component: PlantView,
});

function PlantView() {
  const { plantId } = useParams({ from: "/live/$plantId/" });
  const { resolved } = usePeriod();
  const tick = useLiveTick();
  const [tooltip, setTooltip] = useState<MapTooltipInfo | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const plant = getPlant(plantId);

  const plantMetrics = useMemo(() => {
    void tick;
    return getMetrics(plantId, "plant", plantId, resolved);
  }, [plantId, resolved, tick]);

  const zoneMetrics = useMemo(() => {
    void tick;
    const map: Record<string, ReturnType<typeof getMetrics>> = {};
    if (plant) {
      for (const z of plant.zones) {
        map[z.id] = getMetrics(plantId, "zone", z.id, resolved);
      }
    }
    return map;
  }, [plant, plantId, resolved, tick]);

  if (!plant || !plant.isOperational) {
    return (
      <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
        <PageHeader
          title={plant ? `${plant.name} — ${PLANT_PHASE_LABELS[plant.phase]}` : "Plant Not Found"}
          crumbs={[{ label: "Kemas", to: "/live" }, { label: plant?.name ?? "Plant" }]}
          back={{ label: "Multi Plant", to: "/live" }}
        />
        <main className="p-6">
          <EmptyState
            message={
              plant
                ? `${plant.name} is currently ${PLANT_PHASE_LABELS[plant.phase].toLowerCase()}. Operational data is not available yet.`
                : "Plant tidak ditemukan"
            }
          />
        </main>
      </div>
    );
  }

  const alarms = plantAlarms(plant);
  const occurring = alarms.filter((a) => a.status === "OCCURRING").length;

  const resolvedWording =
    resolved.periodKey === "this-shift"
      ? "resolved this shift"
      : resolved.periodKey === "today"
        ? "resolved today"
        : resolved.periodKey === "this-week"
          ? "resolved this week"
          : resolved.periodKey === "this-month"
            ? "resolved this month"
            : "resolved in selected period";

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={`${plant.name} — Plant View`}
        crumbs={[{ label: "Kemas", to: "/live" }, { label: `${plant.id} · ${plant.block}` }]}
        back={{ label: "Multi Plant", to: "/live" }}
      />
      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 rounded-lg border border-border bg-surface p-3 sm:p-4 transition-colors">
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-start gap-4 pb-3 lg:pb-0 lg:pr-4 border-b lg:border-b-0 lg:border-r border-border/60">
            <div className="flex flex-col items-center shrink-0">
              <Donut value={plantMetrics.oee} size={92} label="Plant OEE" />
              <div className="mt-1 flex flex-col items-center text-center">
                <Delta value={plantMetrics.deltaOee} label={resolved.compareLabel} />
              </div>
            </div>
            <div className="grid w-full sm:w-44 gap-1.5 min-w-36">
              <MetricBar label="Availability" value={plantMetrics.availability} />
              <MetricBar label="Performance" value={plantMetrics.performance} />
              <MetricBar label="Quality" value={plantMetrics.quality} />
            </div>
          </div>
          <div className="grid w-full flex-1 gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 min-w-0">
            {plant.zones.map((z) => {
              const liveZone = zoneMetrics[z.id] ?? z;
              const deltaVal = liveZone.deltaOee;
              return (
                <EntityKpiCard
                  key={z.id}
                  name={z.name}
                  donutValue={liveZone.oee}
                  donutLabel={z.id}
                  oeeValue={liveZone.oee}
                  deltaValue={deltaVal}
                  compareLabel={resolved.compareLabel}
                  availability={liveZone.availability}
                  performance={liveZone.performance}
                  quality={liveZone.quality}
                  dataMetric={`zone-oee-${z.id}`}
                  dataRaw={liveZone.oee}
                  className="min-w-[260px]"
                  onClick={() =>
                    navigate({
                      to: "/live/$plantId/$zoneId",
                      params: { plantId: plant.id, zoneId: z.id },
                    })
                  }
                />
              );
            })}
          </div>
        </div>

        <div className="grid w-full gap-3 lg:grid-cols-[1.6fr_1fr] lg:h-[clamp(560px,calc(100dvh-300px),820px)]">
          <Panel
            title="Zone map"
            subtitle="Click a zone to open Zone View"
            className="min-h-[520px] lg:min-h-0"
            bodyClassName="relative p-0 overflow-hidden"
          >
            {plant.id === "J2" ? (
              <J2PlantZoneMap plant={plant} />
            ) : (
              <div ref={mapContainerRef} className="relative flex min-h-0 flex-1 flex-col w-full">
                <Compass />
                <ZoomableMap className="min-h-[480px] flex-1">
                  <IsoScene viewBox="-270 -115 560 440">
                    <IsoGround
                      cols={plant.zones.length * 2.5 + 0.8}
                      rows={12 * 0.72 + 0.8}
                      s={32}
                    />
                    {plant.zones.map((z, zi) =>
                      z.lines.slice(0, 12).map((l, li) => {
                        const x = 0.6 + zi * 2.5;
                        const y = 0.5 + li * 0.72;
                        const lineM = getMetrics(plant.id, "line", l.id, resolved);
                        const activePO = getActivePO(plant.id, l.id);
                        const isBottleneckLine = true; // In line-level maps, the box represents the bottleneck line
                        return (
                          <g key={`${z.id}-${l.id}`}>
                            <IsoBlock
                              x={x}
                              y={y}
                              w={1.5}
                              d={0.38}
                              h={14 + lineM.oee * 0.4}
                              s={32}
                              color={STATUS_HEX[l.status]}
                              onClick={() =>
                                navigate({
                                  to: "/live/$plantId/$zoneId",
                                  params: { plantId: plant.id, zoneId: z.id },
                                })
                              }
                              onMouseEnter={(e) => {
                                const rect = mapContainerRef.current?.getBoundingClientRect();
                                if (rect) {
                                  setTooltip({
                                    title: `Line ${l.id}`,
                                    subtitle: `${z.name} · ${l.machines.length} machines`,
                                    po: activePO?.poNumber ?? PO_IDLE_PLACEHOLDER,
                                    poOutput: activePO
                                      ? `${activePO.currentOutput.toLocaleString()} / ${activePO.totalMPQ.toLocaleString()}`
                                      : "- / -",
                                    status: l.status,
                                    statusLabel: STATUS_LABEL[l.status],
                                    oee: lineM.oee,
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
                                      ? {
                                          ...curr,
                                          poOutput: activePO
                                            ? `${activePO.currentOutput.toLocaleString()} / ${activePO.totalMPQ.toLocaleString()}`
                                            : "- / -",
                                          x: e.clientX - rect.left,
                                          y: e.clientY - rect.top,
                                        }
                                      : {
                                          title: `Line ${l.id}`,
                                          subtitle: `${z.name} · ${l.machines.length} machines`,
                                          po: activePO?.poNumber ?? PO_IDLE_PLACEHOLDER,
                                          poOutput: activePO
                                            ? `${activePO.currentOutput.toLocaleString()} / ${activePO.totalMPQ.toLocaleString()}`
                                            : "- / -",
                                          status: l.status,
                                          statusLabel: STATUS_LABEL[l.status],
                                          oee: lineM.oee,
                                          x: e.clientX - rect.left,
                                          y: e.clientY - rect.top,
                                        },
                                  );
                                }
                              }}
                              onMouseLeave={() => setTooltip(null)}
                            />
                            {/* Bottleneck Marker above line box */}
                            {li === 0 && (
                              <IsoBottleneckMarker
                                x={x + 0.75}
                                y={y + 0.19}
                                h={14 + lineM.oee * 0.4 + 14}
                                s={32}
                              />
                            )}
                          </g>
                        );
                      }),
                    )}
                    {plant.zones.map((z, zi) => {
                      const zoneOee = zoneMetrics[z.id]?.oee ?? z.oee;
                      return (
                        <IsoChip
                          key={z.id}
                          x={0.6 + zi * 2.5 + 0.75}
                          y={0.2}
                          s={32}
                          h={75}
                          label={z.name}
                          value={`${zoneOee.toFixed(0)}%`}
                          color={TIER_HEX[tierOf(zoneOee)]}
                        />
                      );
                    })}
                  </IsoScene>
                </ZoomableMap>

                <MapStatusLegendOverlay />
                <MapHoverTooltip info={tooltip} />
              </div>
            )}
          </Panel>

          <Panel
            title="Alarms"
            subtitle={`${occurring} occurring · ${alarms.length - occurring} ${resolvedWording}`}
            className="min-h-0 max-h-[420px] lg:max-h-none"
            bodyClassName="p-0 overflow-hidden"
          >
            <div className="min-h-0 flex-1 w-full min-w-0 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[480px] text-[11px]">
                <thead className="sticky top-0 bg-surface text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">Line</th>
                    <th className="px-3 py-2 font-medium">Issue</th>
                    <th className="px-3 py-2 font-medium">Start</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {alarms.map((a) => (
                    <tr key={a.id} className="border-b border-border/60">
                      <td className="px-3 py-2 font-mono">{a.lineId}</td>
                      <td className="px-3 py-2">{a.issue}</td>
                      <td className="px-3 py-2 font-mono">{a.start}</td>
                      <td className="px-3 py-2 font-mono">{a.durationMinutes} min</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            a.status === "OCCURRING"
                              ? "bg-tier-bad/15 text-tier-bad"
                              : "bg-grid text-muted-foreground",
                          )}
                        >
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {alarms.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">
                        No alarms {resolvedWording}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </main>
    </div>
  );
}
