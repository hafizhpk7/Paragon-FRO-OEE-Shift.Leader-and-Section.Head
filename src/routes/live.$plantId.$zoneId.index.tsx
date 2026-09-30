import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  IsoBlock,
  IsoChip,
  IsoGround,
  IsoScene,
  ZoomableMap,
  iso,
  MapHoverTooltip,
  MapStatusLegendOverlay,
  type MapTooltipInfo,
} from "@/components/oee/iso";
import { J2ZoneProductionFloorMap } from "@/components/oee/j2-shopfloor-maps";
import {
  Delta,
  EmptyState,
  KpiCard,
  PageHeader,
  Panel,
  StatusLegend,
  StatusPill,
} from "@/components/oee/ui";
import { STATUS_HEX, STATUS_LABEL, TIER_HEX, tierOf } from "@/lib/oee/config";
import { getZone, type Line } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
import { useApp } from "@/lib/oee/app-context";
import { comparisonContext, useLiveZoneState } from "@/lib/oee/live-display";
import { rand } from "@/lib/oee/rng";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/$plantId/$zoneId/")({
  head: () => ({
    meta: [
      { title: "Zone View — Production Floor Map" },
      {
        name: "description",
        content:
          "Shift Leader home: zone KPI strip and an isometric production floor map with per-line and per-machine status.",
      },
      { property: "og:title", content: "Zone View — Production Floor Map" },
      {
        property: "og:description",
        content: "Zone KPI strip plus isometric production floor map with live line status.",
      },
    ],
  }),
  component: ZoneView,
});

const S = 38;
const GAP_X = 2.4;
const GAP_Y = 2.5;
const BLOCK_W = 0.95;
const BLOCK_D = 0.95;

function ZoneView() {
  const { plantId, zoneId } = useParams({ from: "/live/$plantId/$zoneId/" });
  const zone = getZone(plantId, zoneId);

  if (!zone) {
    return (
      <div className="p-6">
        <EmptyState message="Zone tidak ditemukan" />
      </div>
    );
  }

  return <ZoneContent plantId={plantId} zone={zone} />;
}

function ZoneContent({
  plantId,
  zone,
}: {
  plantId: string;
  zone: NonNullable<ReturnType<typeof getZone>>;
}) {
  const zoneId = zone.id;
  const [period, setPeriod] = useState<PeriodId>("live");
  const [selected, setSelected] = useState<Line | null>(null);
  const [hovered, setHovered] = useState<Line | null>(null);
  const [tooltip, setTooltip] = useState<MapTooltipInfo | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const activeLine = selected ?? hovered;
  const [showIssues, setShowIssues] = useState(false);
  const navigate = useNavigate();
  const { role } = useApp();

  const liveState = useLiveZoneState(
    period,
    zone.id,
    { availability: zone.availability, performance: zone.performance, quality: zone.quality },
    zone.lines,
  );
  const statusForLine = (line: Line) => liveState.lineStatuses[line.id] ?? line.status;
  const down = zone.lines.filter((l) => statusForLine(l) === "down").length;
  const slow = zone.lines.filter((l) => statusForLine(l) === "slow").length;
  const idle = zone.lines.filter((l) => statusForLine(l) === "idle").length;
  const machineCount = zone.lines.reduce((a, l) => a + l.machines.length, 0);
  const rows = 3;
  const cols = 5;
  const compareLabel = comparisonContext(period);
  const issues = useMemo(() => {
    const priority = { down: 0, slow: 1, idle: 2 } as const;
    const reasons = {
      down: [
        "Mechanical Breakdown",
        "Setup/Changeover",
        "Conveyor Jam at infeed",
        "Bearing seizure on main drive",
      ],
      slow: ["Material Shortage", "Reduced Speed", "Minor Stops", "Film splice sensor fault"],
      idle: ["No Production Order", "Waiting Material", "Planned Cleaning"],
    } as const;
    return zone.lines
      .map((line) => ({ line, status: liveState.lineStatuses[line.id] ?? line.status }))
      .filter((item) => item.status !== "running")
      .map((item) => {
        const pool = reasons[item.status];
        const reason =
          item.line.fault ??
          pool[
            Math.floor(rand(`${zone.id}-${item.line.id}-reason`, 0, pool.length, 4)) % pool.length
          ];
        const durationMinutes =
          item.status === "down"
            ? Math.round(rand(`${zone.id}-${item.line.id}-duration`, 12, 75, 0))
            : item.status === "slow"
              ? Math.round(rand(`${zone.id}-${item.line.id}-duration`, 8, 45, 0))
              : Math.round(rand(`${zone.id}-${item.line.id}-duration`, 15, 60, 0));
        return {
          ...item,
          reason,
          duration: `${durationMinutes} mins`,
          durationMinutes,
        };
      })
      .sort(
        (a, b) => priority[a.status] - priority[b.status] || b.durationMinutes - a.durationMinutes,
      );
  }, [liveState.lineStatuses, zone.id, zone.lines]);

  // Shift Leader enters here directly, so no Plant in the breadcrumb; Section Head
  // arrives by drill-down, so Plant is included (§4.1.3).
  const crumbs =
    role === "section-head"
      ? [
          { label: "Kemas", to: "/live" },
          { label: plantId, to: "/live/$plantId", params: { plantId } },
          { label: `${zone.name} · Shift 1` },
        ]
      : [{ label: "Kemas", to: "/" }, { label: `${zone.name} · Shift 1` }];

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={zone.name}
        crumbs={crumbs}
        period={period}
        onPeriod={setPeriod}
        meta="Week 32 · 05-Aug 14:22"
        {...(role === "section-head"
          ? { back: { label: "Plant View", to: "/live/$plantId", params: { plantId } } }
          : {})}
      />
      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          <KpiCard
            label="Zone OEE"
            value={liveState.metrics.oee.toFixed(1)}
            unit="%"
            tone={
              tierOf(liveState.metrics.oee) === "good"
                ? "good"
                : tierOf(liveState.metrics.oee) === "warn"
                  ? "warn"
                  : "bad"
            }
            caption={<Delta value={liveState.deltas.oee} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Availability"
            value={liveState.metrics.availability.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.availability} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Performance"
            value={liveState.metrics.performance.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.performance} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Quality"
            value={liveState.metrics.quality.toFixed(1)}
            unit="%"
            caption={<Delta value={liveState.deltas.quality} />}
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          {/* §7 point 5: one name only — "LINES DOWN". */}
          <KpiCard
            label="Lines Down"
            value={`${down} of ${zone.lines.length}`}
            tone={down > 0 ? "bad" : "good"}
            caption={`${slow} slow · ${idle} idle`}
            onClick={() => setShowIssues(true)}
          >
            <div className="mt-1 flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
              <span>View Details</span>
              <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </div>
          </KpiCard>
        </div>

        <Panel
          className="flex-1 w-full min-w-0"
          title="Production Floor Map"
          subtitle={`${zone.lines.length} lines · ${machineCount} machines`}
          bodyClassName="relative p-0 overflow-hidden"
        >
          {plantId === "J2" ? (
            <J2ZoneProductionFloorMap plantId={plantId} zone={zone} />
          ) : (
            <div
              ref={mapContainerRef}
              className="relative h-full w-full min-h-[400px] sm:min-h-[500px] md:min-h-[600px] flex-1"
            >
              <ZoomableMap className="min-h-[400px] sm:min-h-[500px] md:min-h-[600px] flex-1">
                <IsoScene viewBox="-260 -100 620 460">
                  <IsoGround cols={cols * GAP_X + 0.6} rows={rows * GAP_Y + 0.6} s={S} />
                  {zone.lines.map((l, i) => {
                    const bx = 0.5 + (i % cols) * GAP_X;
                    const by = 0.5 + Math.floor(i / cols) * GAP_Y;
                    const isActive = activeLine?.id === l.id;
                    const lineStatus = statusForLine(l);
                    return (
                      <g key={l.id}>
                        <IsoBlock
                          x={bx}
                          y={by}
                          w={BLOCK_W}
                          d={BLOCK_D}
                          h={isActive ? 30 : 20}
                          s={S}
                          color={STATUS_HEX[lineStatus]}
                          onClick={() => setSelected((curr) => (curr?.id === l.id ? null : l))}
                          onMouseEnter={(e) => {
                            setHovered(l);
                            const rect = mapContainerRef.current?.getBoundingClientRect();
                            if (rect) {
                              setTooltip({
                                title: `Line ${l.id}`,
                                subtitle: `${l.sku} · ${l.machines.length} machines`,
                                status: lineStatus,
                                statusLabel: STATUS_LABEL[lineStatus],
                                oee: l.oee,
                                x: e.clientX - rect.left,
                                y: e.clientY - rect.top,
                              });
                            }
                          }}
                          onMouseMove={(e) => {
                            const rect = mapContainerRef.current?.getBoundingClientRect();
                            if (rect) {
                              setTooltip({
                                title: `Line ${l.id}`,
                                subtitle: `${l.sku} · ${l.machines.length} machines`,
                                status: lineStatus,
                                statusLabel: STATUS_LABEL[lineStatus],
                                oee: l.oee,
                                x: e.clientX - rect.left,
                                y: e.clientY - rect.top,
                              });
                            }
                          }}
                          onMouseLeave={() => {
                            setHovered((curr) => (curr?.id === l.id ? null : curr));
                            setTooltip(null);
                          }}
                          dim={!!activeLine && !isActive}
                        />
                        {/* machine status dots inside the line footprint */}
                        {l.machines.map((m, mi) => {
                          const p = iso(bx + 0.2 + mi * 0.22, by + 0.48, isActive ? 34 : 24, S);
                          return (
                            <circle
                              key={m.id}
                              cx={p.x}
                              cy={p.y}
                              r={2.8}
                              fill={
                                STATUS_HEX[liveState.machineStatuses[`${l.id}:${m.id}`] ?? m.status]
                              }
                              stroke="var(--surface)"
                              strokeWidth={0.8}
                            />
                          );
                        })}
                        <IsoChip
                          x={bx + BLOCK_W / 2}
                          y={by + BLOCK_D / 2}
                          s={S}
                          h={isActive ? 34 : 24}
                          label={l.id}
                          value={`${l.oee.toFixed(0)}%`}
                          color={TIER_HEX[tierOf(l.oee)]}
                        />
                      </g>
                    );
                  })}
                </IsoScene>
              </ZoomableMap>

              <MapStatusLegendOverlay />
              <MapHoverTooltip info={tooltip} />
            </div>
          )}

          {activeLine && (
            <div
              className="pointer-events-auto absolute right-4 top-4 z-30 w-64 rounded-lg border border-border bg-surface/95 p-3 shadow-xl backdrop-blur-sm"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => {
                if (!selected && hovered) {
                  setSelected(hovered);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{activeLine.id}</span>
                  <StatusPill status={statusForLine(activeLine)} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setHovered(null);
                  }}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  aria-label="Close line tooltip"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">OEE</dt>
                  <dd className="font-mono">{activeLine.oee.toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Output</dt>
                  <dd className="font-mono">
                    {activeLine.outputActual.toLocaleString()} /{" "}
                    {activeLine.outputTarget.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Machines</dt>
                  <dd className="font-mono">{activeLine.machines.length}</dd>
                </div>
                {activeLine.fault && (
                  <div className="rounded bg-tier-bad/10 px-2 py-1 text-tier-bad">
                    {activeLine.fault}
                  </div>
                )}
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {activeLine.machines.map((m) => (
                  <span
                    key={m.id}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {m.id}
                  </span>
                ))}
              </div>
              <Link
                to="/live/$plantId/$zoneId/$lineId"
                params={{ plantId, zoneId, lineId: activeLine.id }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 active:bg-primary/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              >
                <span>Click to open line detail →</span>
              </Link>
            </div>
          )}
        </Panel>
      </main>
      <Dialog open={showIssues} onOpenChange={setShowIssues}>
        <DialogContent className="w-[95vw] md:w-auto md:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lines Requiring Attention</DialogTitle>
            <DialogDescription>
              Current Down, Slow, and Idle lines in {zone.name} with real-time operational status.
            </DialogDescription>
          </DialogHeader>
          <div className="w-full min-w-0 overflow-x-auto rounded-md border border-border">
            <Table className="min-w-[500px]">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="font-semibold text-xs text-foreground">Line Name</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">
                    Status Badge
                  </TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">
                    Downtime Reason
                  </TableHead>
                  <TableHead className="text-right font-semibold text-xs text-foreground">
                    Duration
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((issue) => (
                  <TableRow
                    key={issue.line.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      setShowIssues(false);
                      navigate({
                        to: "/live/$plantId/$zoneId/$lineId",
                        params: { plantId, zoneId, lineId: issue.line.id },
                      });
                    }}
                  >
                    <TableCell className="font-mono font-semibold text-xs text-foreground">
                      <span className="hover:underline">{issue.line.id}</span>
                    </TableCell>
                    <TableCell>
                      {issue.status === "down" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-900/60">
                          <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-400" />
                          Down
                        </span>
                      )}
                      {issue.status === "slow" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                          <span className="size-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
                          Slow
                        </span>
                      )}
                      {issue.status === "idle" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          <span className="size-1.5 rounded-full bg-slate-500" />
                          Idle
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-foreground">{issue.reason}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {issue.duration}
                    </TableCell>
                  </TableRow>
                ))}
                {issues.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-xs text-muted-foreground"
                    >
                      All lines are running normally.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
