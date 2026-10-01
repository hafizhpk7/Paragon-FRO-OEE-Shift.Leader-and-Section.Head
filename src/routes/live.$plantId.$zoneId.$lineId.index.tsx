import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { TrendChart } from "@/components/oee/charts";
import {
  IsoBlock,
  IsoChip,
  IsoGround,
  IsoScene,
  MapHoverTooltip,
  type MapTooltipInfo,
} from "@/components/oee/iso";
import { LineChainView3D } from "@/components/oee/three/line-chain-view-3d";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComparisonLabel,
  Delta,
  EmptyState,
  KpiCard,
  PageHeader,
  Panel,
  StatusLegend,
  StatusPill,
} from "@/components/oee/ui";
import { STATUS_HEX, STATUS_LABEL, TIER_HEX, tierOf } from "@/lib/oee/config";
import { bucketsFor, getLine, getZone, lineAlarms, trendSeries } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
import { comparisonContext, useLiveLineState } from "@/lib/oee/live-display";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/$plantId/$zoneId/$lineId/")({
  head: () => ({
    meta: [
      { title: "Line Detail — Live Monitor" },
      {
        name: "description",
        content:
          "Line level live monitor: KPI strip, line condition, machine chain, active alarms and OEE/output/speed trends.",
      },
      { property: "og:title", content: "Line Detail — Live Monitor" },
      {
        property: "og:description",
        content: "KPI strip, line condition, alarms and trends for one line.",
      },
    ],
  }),
  component: LineDetail,
});

function LineDetail() {
  const { plantId, zoneId, lineId } = useParams({ from: "/live/$plantId/$zoneId/$lineId/" });
  const [period, setPeriod] = useState<PeriodId>("live");
  const [tooltip, setTooltip] = useState<MapTooltipInfo | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const zone = getZone(plantId, zoneId);
  const line = getLine(plantId, zoneId, lineId);
  const liveState = useLiveLineState(period, plantId, zoneId, lineId);
  const liveLine = liveState.line;

  if (!zone || !line) {
    return (
      <div className="p-6">
        <EmptyState message="Line tidak ditemukan" />
      </div>
    );
  }

  const buckets = bucketsFor(60, 1);
  const oeeTrend = trendSeries(`${line.id}-oee`, buckets, ["OEE"], liveLine.oee, 7);
  const outputTrend = buckets.map((label, i) => ({
    label,
    "Cumulative %": Math.round(Math.min(100, ((i + 1) / buckets.length) * 100 * 0.92) * 10) / 10,
    Plan: Math.round(((i + 1) / buckets.length) * 100),
  }));
  const speedTrend = trendSeries(`${line.id}-spd`, buckets, ["Speed"], liveLine.speed, 14);
  const alarms = lineAlarms(line);

  // "Behind pace" = actual vs a simple linear projection of the shift target (§7 point 13).
  const elapsedRatio = liveLine.runningMinutes / 480;
  const paceTarget = Math.round(line.outputTarget * elapsedRatio);
  const behind = liveLine.outputActual < paceTarget;
  const compareLabel = comparisonContext(period);

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={`${line.id} — Line Detail`}
        crumbs={[
          { label: "Kemas", to: "/live" },
          { label: zone.name, to: "/live/$plantId/$zoneId", params: { plantId, zoneId } },
          { label: `${line.id} · Shift 1` },
        ]}
        period={period}
        onPeriod={setPeriod}
        back={{ label: zone.name, to: "/live/$plantId/$zoneId", params: { plantId, zoneId } }}
      />
      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 pb-12 min-w-0 max-w-full overflow-x-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
          <KpiCard
            label="Line OEE"
            value={liveLine.oee.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.oee} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Availability"
            value={liveLine.availability.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.availability} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Performance"
            value={liveLine.performance.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.performance} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Quality"
            value={liveLine.quality.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.quality} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Output"
            value={liveLine.outputActual.toLocaleString()}
            unit="pcs"
            isUpdating={liveState.isUpdating}
            caption={
              behind ? (
                <span className="text-tier-bad">
                  behind pace · plan {paceTarget.toLocaleString()}
                </span>
              ) : (
                <span className="text-tier-good">on pace · plan {paceTarget.toLocaleString()}</span>
              )
            }
          />
          <KpiCard
            label="Running time"
            value={`${Math.floor(liveLine.runningMinutes / 60)}h ${Math.floor(liveLine.runningMinutes % 60)}m`}
          />
          <KpiCard
            label="Status"
            value={liveLine.status.toUpperCase()}
            tone={liveLine.status === "down" ? "bad" : liveLine.status === "slow" ? "warn" : "good"}
            caption={
              liveLine.status === "down"
                ? `caused by ${line.machines[0]?.id}`
                : "all machines nominal"
            }
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr]">
          <Panel title="Line Condition">
            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                ["Current SKU", line.sku],
                ["PO / Batch", `${line.po} · ${line.batch}`],
                [
                  "Shift output",
                  `${liveLine.outputActual.toLocaleString()} / ${line.outputTarget.toLocaleString()}`,
                ],
                ["MPQ target", `${line.mpqTarget} ppm`],
                ["Zone · Shift", `${zone.name} · Shift 1`],
                ["Bottleneck", line.bottleneck],
              ].map(([k, v]) => (
                <div key={k} className="rounded border border-border px-2 py-1.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel
            title="Machine chain"
            subtitle="Click any machine for real-time sensor telemetry"
            action={<StatusLegend />}
            bodyClassName="relative p-0 flex flex-col"
          >
            <div className="relative min-h-[340px] w-full flex-1 overflow-hidden">
              <LineChainView3D plantId={plantId} zoneId={zoneId} line={line} />
            </div>
            <div className="border-t border-border px-4 py-2">
              <StatusPill status={line.status} />
            </div>
          </Panel>
        </div>

        <Panel
          title="Active Alarms"
          subtitle="Shares the same source as Alarms on Plant View"
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {alarms.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-[11px]">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    a.severity === "CRITICAL"
                      ? "bg-tier-bad/15 text-tier-bad"
                      : "bg-tier-warn/20 text-tier-warn",
                  )}
                >
                  {a.severity}
                </span>
                <span className="font-mono">
                  {a.lineId}·{a.machineId}
                </span>
                <span className="font-mono text-muted-foreground">{a.start}</span>
                <span className="flex-1">{a.issue}</span>
                <span className="font-mono text-muted-foreground">{a.durationMinutes} min</span>
                <span
                  className={cn(
                    "font-semibold uppercase",
                    a.status === "OCCURRING" ? "text-tier-bad" : "text-muted-foreground",
                  )}
                >
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Trend Charts Section */}
        <div className="grid w-full shrink-0 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Panel
            title="OEE trend"
            className="h-[340px] w-full min-w-0"
            bodyClassName="h-[270px] w-full p-2"
          >
            <div className="h-[250px] w-full">
              <TrendChart data={oeeTrend} keys={["OEE"]} reference={75} height={250} />
            </div>
          </Panel>
          <Panel
            title="Output trend"
            subtitle="Cumulative %, resets on PO/batch change"
            className="h-[340px] w-full min-w-0"
            bodyClassName="h-[270px] w-full p-2"
          >
            <div className="h-[250px] w-full">
              <TrendChart data={outputTrend} keys={["Cumulative %", "Plan"]} height={250} />
            </div>
          </Panel>
          <Panel
            title="Line speed"
            subtitle={`Standard ${line.stdSpeed} ppm`}
            className="h-[340px] w-full min-w-0"
            bodyClassName="h-[270px] w-full p-2"
          >
            <div className="h-[250px] w-full">
              <TrendChart
                data={speedTrend}
                keys={["Speed"]}
                reference={line.stdSpeed}
                height={250}
              />
            </div>
          </Panel>
        </div>

        {/* Machines Section */}
        <Card className="h-auto w-full min-w-0 shrink-0 overflow-visible rounded-lg border border-border bg-surface shadow-xs">
          <CardHeader className="border-b border-border px-4 py-3">
            <CardTitle className="text-sm font-semibold tracking-tight text-foreground">
              Machines
            </CardTitle>
            <CardDescription className="text-[11px] text-muted-foreground">
              Open a machine page for sensor detail and current stop
            </CardDescription>
          </CardHeader>
          <CardContent className="h-auto overflow-visible p-4 pb-6">
            <div className="grid h-auto w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {line.machines.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/live/$plantId/$zoneId/$lineId/$machineId",
                      params: { plantId, zoneId, lineId, machineId: m.id },
                    })
                  }
                  className="group flex h-auto min-h-[116px] w-full min-w-0 flex-col justify-between gap-2.5 rounded-lg border border-border bg-muted/50 p-4 text-left transition-colors hover:border-primary hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-muted/30 dark:hover:bg-muted/60"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm font-semibold">{m.id}</span>
                    <span className="shrink-0">
                      <StatusPill status={m.status} />
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{m.type}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs leading-relaxed text-foreground/90">
                    <span>OEE {m.oee.toFixed(1)}%</span>
                    <span className="text-muted-foreground/60" aria-hidden="true">
                      ·
                    </span>
                    <span>MTTR {m.mttr}m</span>
                    <span className="text-muted-foreground/60" aria-hidden="true">
                      ·
                    </span>
                    <span>MTBF {m.mtbf}m</span>
                  </div>
                  <span className="pt-1 text-[11px] font-medium text-primary group-hover:underline">
                    Open machine page →
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
