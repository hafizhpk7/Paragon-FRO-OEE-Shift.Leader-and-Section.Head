import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";

import { Compass, IsoBlock, IsoChip, IsoGround, IsoScene, ZoomableMap } from "@/components/oee/iso";
import { Donut, EmptyState, MetricBar, PageHeader, Panel, StatusLegend } from "@/components/oee/ui";
import { STATUS_HEX, TIER_HEX, tierOf } from "@/lib/oee/config";
import { getPlant, plantAlarms } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
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
  const navigate = useNavigate();
  const plant = getPlant(plantId);

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
      <main className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-4 pr-4">
            <Donut value={plant.oee} size={92} label="Plant OEE" />
            <div className="grid w-44 gap-1.5">
              <MetricBar label="Availability" value={plant.availability} />
              <MetricBar label="Performance" value={plant.performance} />
              <MetricBar label="Quality" value={plant.quality} />
            </div>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            {plant.zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() =>
                  navigate({
                    to: "/live/$plantId/$zoneId",
                    params: { plantId: plant.id, zoneId: z.id },
                  })
                }
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary"
              >
                <Donut value={z.oee} size={58} label={z.id} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-xs font-semibold">{z.name}</p>
                  <MetricBar label="A" value={z.availability} />
                  <MetricBar label="P" value={z.performance} />
                  <MetricBar label="Q" value={z.quality} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid flex-1 auto-rows-fr gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Panel
            title="Zone map"
            subtitle="Click a zone to open Zone View"
            action={<StatusLegend />}
            bodyClassName="relative p-0"
          >
            <Compass />
            <ZoomableMap className="min-h-[380px] flex-1">
              <IsoScene viewBox="-185 -105 365 305">
                <IsoGround cols={6} rows={6} s={34} />
                {plant.zones.map((z, zi) =>
                  z.lines.slice(0, 12).map((l, li) => {
                    const x = 0.4 + zi * 1.9;
                    const y = 0.3 + li * 0.45;
                    return (
                      <IsoBlock
                        key={`${z.id}-${l.id}`}
                        x={x}
                        y={y}
                        w={1.5}
                        d={0.32}
                        h={12 + l.oee * 0.4}
                        s={34}
                        color={STATUS_HEX[l.status]}
                        onClick={() =>
                          navigate({
                            to: "/live/$plantId/$zoneId",
                            params: { plantId: plant.id, zoneId: z.id },
                          })
                        }
                      />
                    );
                  }),
                )}
                {plant.zones.map((z, zi) => (
                  <IsoChip
                    key={z.id}
                    x={1.15 + zi * 1.9}
                    y={0.2}
                    s={34}
                    h={70}
                    label={z.name}
                    value={`${z.oee.toFixed(0)}%`}
                    color={TIER_HEX[tierOf(z.oee)]}
                  />
                ))}
              </IsoScene>
            </ZoomableMap>
          </Panel>

          <Panel
            title="Alarms"
            subtitle={`${occurring} occurring · ${alarms.length - occurring} resolved this shift`}
            bodyClassName="p-0"
          >
            <div className="h-full min-h-[380px] overflow-auto">
              <table className="w-full text-[11px]">
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
