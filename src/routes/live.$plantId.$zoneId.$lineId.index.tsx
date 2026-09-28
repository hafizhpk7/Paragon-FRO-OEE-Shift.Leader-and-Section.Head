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
      <main className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            label="Line OEE"
            value={liveLine.oee.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.oee} />}
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
            label="Output"
            value={liveLine.outputActual.toLocaleString()}
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
            subtitle="Static snapshot — not clickable (read-only)"
            action={<StatusLegend />}
            bodyClassName="relative p-0"
          >
            <div ref={mapContainerRef} className="relative h-[210px] w-full overflow-hidden">
              <IsoScene viewBox="-60 -75 255 195">
                <IsoGround cols={line.machines.length * 1.35 + 0.6} rows={1.5} s={38} />
                {line.machines.map((m, i) => (
                  <g key={m.id}>
                    <IsoBlock
                      x={0.4 + i * 1.35}
                      y={0.2}
                      w={0.85}
                      d={0.85}
                      h={26}
                      s={38}
                      color={STATUS_HEX[m.status]}
                      onMouseEnter={(e) => {
                        const rect = mapContainerRef.current?.getBoundingClientRect();
                        if (rect) {
                          setTooltip({
                            title: `${m.id} (${m.type})`,
                            subtitle: `MTTR ${m.mttr}m · MTBF ${m.mtbf}m`,
                            status: m.status,
                            statusLabel: STATUS_LABEL[m.status],
                            oee: m.oee,
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
                                  title: `${m.id} (${m.type})`,
                                  subtitle: `MTTR ${m.mttr}m · MTBF ${m.mtbf}m`,
                                  status: m.status,
                                  statusLabel: STATUS_LABEL[m.status],
                                  oee: m.oee,
                                  x: e.clientX - rect.left,
                                  y: e.clientY - rect.top,
                                },
                          );
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                    <IsoChip
                      x={0.82 + i * 1.35}
                      y={0.62}
                      s={38}
                      h={30}
                      label={m.id}
                      value={`${m.oee.toFixed(0)}%`}
                      color={TIER_HEX[tierOf(m.oee)]}
                    />
                  </g>
                ))}
              </IsoScene>

              <MapHoverTooltip info={tooltip} />
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

        <div className="grid min-h-[340px] flex-1 auto-rows-fr items-stretch gap-3 lg:grid-cols-3">
          <Panel title="OEE trend" bodyClassName="relative min-h-[250px] h-full w-full flex-1">
            <TrendChart data={oeeTrend} keys={["OEE"]} reference={75} />
          </Panel>
          <Panel
            title="Output trend"
            subtitle="Cumulative %, resets on PO/batch change"
            bodyClassName="relative min-h-[250px] h-full w-full flex-1"
          >
            <TrendChart data={outputTrend} keys={["Cumulative %", "Plan"]} />
          </Panel>
          <Panel
            title="Line speed"
            subtitle={`Standard ${line.stdSpeed} ppm`}
            bodyClassName="relative min-h-[250px] h-full w-full flex-1"
          >
            <TrendChart data={speedTrend} keys={["Speed"]} reference={line.stdSpeed} />
          </Panel>
        </div>

        <Panel title="Machines" subtitle="Open a machine page for sensor detail and current stop">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{m.id}</span>
                  <StatusPill status={m.status} />
                </div>
                <p className="text-[11px] text-muted-foreground">{m.type}</p>
                <p className="font-mono text-xs">
                  OEE {m.oee.toFixed(1)}% · MTTR {m.mttr}m · MTBF {m.mtbf}m
                </p>
                <span className="mt-1 text-[11px] font-medium text-primary">
                  Open machine page →
                </span>
              </button>
            ))}
          </div>
        </Panel>
      </main>
    </div>
  );
}
