import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";

import {
  Compass,
  IsoBlock,
  IsoChip,
  IsoGround,
  IsoScene,
  ZoomableMap,
  MapHoverTooltip,
  MapStatusLegendOverlay,
  type MapTooltipInfo,
} from "@/components/oee/iso";
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
import { STATUS_HEX, STATUS_LABEL, TIER_HEX, tierOf } from "@/lib/oee/config";
import { getPlant, plantAlarms } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
import { useLivePlantState } from "@/lib/oee/live-display";
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
  const [period, setPeriod] = useState<PeriodId>("live");
  const [tooltip, setTooltip] = useState<MapTooltipInfo | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const plant = getPlant(plantId);
  const liveState = useLivePlantState(period, plantId);

  if (!plant) {
    return (
      <div className="p-6">
        <EmptyState message="Plant tidak ditemukan" />
      </div>
    );
  }

  const alarms = plantAlarms(plant);
  const occurring = alarms.filter((a) => a.status === "OCCURRING").length;

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={`${plant.name} — Plant View`}
        // "Blok" has no definition in any document (§7 point 2): static breadcrumb text only.
        crumbs={[
          { label: "Kemas", to: "/live" },
          { label: `${plant.id} · ${plant.block} · Shift 1` },
        ]}
        period={period}
        onPeriod={setPeriod}
        meta="Week 32 · 05-Aug 14:22"
        back={{ label: "Multi Plant", to: "/live" }}
      />
      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden">
        <div
          className={cn(
            "flex flex-col lg:flex-row items-stretch lg:items-center gap-4 rounded-lg border border-border bg-surface p-3 sm:p-4 transition-colors",
            liveState.isUpdating && "border-primary/50 shadow-[0_0_12px_rgba(59,130,246,0.15)]",
          )}
        >
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-start gap-4 pb-3 lg:pb-0 lg:pr-4 border-b lg:border-b-0 lg:border-r border-border/60">
            <div className="flex flex-col items-center shrink-0">
              <Donut value={liveState.plant.oee} size={92} label="Plant OEE" />
              <div className="mt-1 flex flex-col items-center text-center">
                <Delta value={liveState.plantDeltas.oee} />
                <ComparisonLabel period={period} />
              </div>
            </div>
            <div className="grid w-full sm:w-44 gap-1.5 min-w-36">
              <MetricBar label="Availability" value={liveState.plant.availability} />
              <MetricBar label="Performance" value={liveState.plant.performance} />
              <MetricBar label="Quality" value={liveState.plant.quality} />
            </div>
          </div>
          <div className="grid w-full flex-1 gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {plant.zones.map((z) => {
              const liveZone = liveState.zones[z.id] ?? z;
              const deltaVal = liveState.zoneDeltas[z.id] ?? 0;
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/live/$plantId/$zoneId",
                      params: { plantId: plant.id, zoneId: z.id },
                    })
                  }
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary cursor-pointer",
                    liveState.isUpdating && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex flex-col items-center">
                    <Donut value={liveZone.oee} size={58} label={z.id} />
                    <div className="mt-1 flex flex-col items-center text-center">
                      <Delta value={deltaVal} />
                      <ComparisonLabel period={period} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-xs font-semibold">{z.name}</p>
                    <MetricBar label="A" value={liveZone.availability} />
                    <MetricBar label="P" value={liveZone.performance} />
                    <MetricBar label="Q" value={liveZone.quality} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid flex-1 w-full gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Panel
            title="Zone map"
            subtitle="Click a zone to open Zone View"
            bodyClassName="relative p-0 overflow-hidden"
          >
            <div
              ref={mapContainerRef}
              className="relative h-full w-full min-h-[400px] md:min-h-[500px] flex-1"
            >
              <Compass />
              <ZoomableMap className="min-h-[400px] md:min-h-[500px] flex-1">
                <IsoScene viewBox="-270 -115 560 440">
                  <IsoGround cols={plant.zones.length * 2.5 + 0.8} rows={12 * 0.72 + 0.8} s={32} />
                  {plant.zones.map((z, zi) =>
                    z.lines.slice(0, 12).map((l, li) => {
                      const x = 0.6 + zi * 2.5;
                      const y = 0.5 + li * 0.72;
                      return (
                        <IsoBlock
                          key={`${z.id}-${l.id}`}
                          x={x}
                          y={y}
                          w={1.5}
                          d={0.38}
                          h={14 + l.oee * 0.4}
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
                                status: l.status,
                                statusLabel: STATUS_LABEL[l.status],
                                oee: l.oee,
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
                                      title: `Line ${l.id}`,
                                      subtitle: `${z.name} · ${l.machines.length} machines`,
                                      status: l.status,
                                      statusLabel: STATUS_LABEL[l.status],
                                      oee: l.oee,
                                      x: e.clientX - rect.left,
                                      y: e.clientY - rect.top,
                                    },
                              );
                            }
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      );
                    }),
                  )}
                  {plant.zones.map((z, zi) => {
                    const zoneOee = liveState.zones[z.id]?.oee ?? z.oee;
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
          </Panel>

          <Panel
            title="Alarms"
            subtitle={`${occurring} occurring · ${alarms.length - occurring} resolved this shift`}
            bodyClassName="p-0 overflow-hidden"
          >
            <div className="h-full min-h-[380px] w-full min-w-0 overflow-x-auto overflow-y-auto">
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
                        No alarms this shift
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
